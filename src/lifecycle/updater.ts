import * as z from "zod/v4";
import { captureTelemetryError, captureTelemetryMessage } from "../observability/telemetry.js";
import { ConfigurationError, RouterConnectionError, getErrorMessage } from "../utils/errors.js";

export type UpdatePlatform =
  | "windows-x86_64"
  | "darwin-x86_64"
  | "darwin-aarch64"
  | "linux-x86_64";

export type UpdateMonitorState =
  | "idle"
  | "checking"
  | "downloading"
  | "verified_ready"
  | "deferred_active_sessions"
  | "failed"
  | "stopped";

export interface TauriUpdaterManifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<
    UpdatePlatform,
    {
      url: string;
      signature: string;
    }
  >;
}

export interface VerifiedUpdate {
  version: string;
  platform: UpdatePlatform;
  url: string;
  signature: string;
  notes?: string;
  pubDate?: string;
  verifiedAt: string;
}

export interface UpdateStatusSnapshot {
  state: UpdateMonitorState;
  currentVersion: string;
  lastCheckedAt?: string;
  readyUpdate?: VerifiedUpdate;
  lastError?: string;
}

export interface ActiveSessionProbe {
  hasActiveToolCallingSessions(): Promise<boolean>;
}

export interface NativeUpdateBridge {
  downloadAndVerify(update: VerifiedUpdate): Promise<VerifiedUpdate>;
  promptForRestart(update: VerifiedUpdate): Promise<"accepted" | "dismissed">;
  installAndRestart(update: VerifiedUpdate): Promise<void>;
  notify(message: NativeNotification): Promise<void>;
}

export interface NativeNotification {
  title: string;
  body: string;
  severity: "info" | "warning" | "error";
}

export interface UpdateMonitorOptions {
  manifestUrl: string;
  currentVersion: string;
  platform?: UpdatePlatform;
  checkIntervalMs?: number;
  fetchTimeoutMs?: number;
  activeSessionProbe: ActiveSessionProbe;
  nativeBridge?: NativeUpdateBridge;
  fetcher?: typeof fetch;
}

interface TauriCore {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

const manifestPlatformSchema = z.object({
  url: z.string().url(),
  signature: z.string().min(32),
});

const updatePlatformSchema = z.enum([
  "windows-x86_64",
  "darwin-x86_64",
  "darwin-aarch64",
  "linux-x86_64",
]);

const manifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  notes: z.string().optional(),
  pub_date: z.string().datetime().optional(),
  platforms: z.record(updatePlatformSchema, manifestPlatformSchema),
});

export class TauriUpdateMonitor {
  private readonly fetcher: typeof fetch;
  private readonly nativeBridge: NativeUpdateBridge;
  private readonly platform: UpdatePlatform;
  private readonly checkIntervalMs: number;
  private readonly fetchTimeoutMs: number;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<UpdateStatusSnapshot> | undefined;
  private snapshot: UpdateStatusSnapshot;

  constructor(private readonly options: UpdateMonitorOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.nativeBridge = options.nativeBridge ?? new TauriNativeUpdateBridge();
    this.platform = options.platform ?? detectUpdatePlatform();
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.snapshot = {
      state: "idle",
      currentVersion: options.currentVersion,
    };
  }

  getStatus(): Readonly<UpdateStatusSnapshot> {
    return Object.freeze({ ...this.snapshot });
  }

  start(): void {
    if (this.timer) {
      return;
    }

    void this.checkNow();
    this.timer = setInterval(() => {
      void this.checkNow();
    }, this.checkIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    this.snapshot = {
      ...this.snapshot,
      state: "stopped",
    };
  }

  async checkNow(): Promise<UpdateStatusSnapshot> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = undefined;
    });

    return this.inFlight;
  }

  async installReadyUpdate(): Promise<void> {
    const readyUpdate = this.snapshot.readyUpdate;
    if (!readyUpdate) {
      throw new ConfigurationError("No verified update is ready to install.");
    }

    await this.nativeBridge.installAndRestart(readyUpdate);
  }

  private async runCheck(): Promise<UpdateStatusSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      state: "checking",
      lastCheckedAt: new Date().toISOString(),
      lastError: undefined,
    };

    try {
      const manifest = await this.fetchManifest();
      const update = selectUpdateForPlatform(
        manifest,
        this.platform,
        this.options.currentVersion,
      );

      if (!update) {
        this.snapshot = {
          ...this.snapshot,
          state: "idle",
          readyUpdate: undefined,
        };
        return this.snapshot;
      }

      const hasActiveSessions =
        await this.options.activeSessionProbe.hasActiveToolCallingSessions();
      if (hasActiveSessions) {
        this.snapshot = {
          ...this.snapshot,
          state: "deferred_active_sessions",
          readyUpdate: update,
        };
        return this.snapshot;
      }

      this.snapshot = {
        ...this.snapshot,
        state: "downloading",
      };

      const verified = await this.nativeBridge.downloadAndVerify(update);
      this.snapshot = {
        ...this.snapshot,
        state: "verified_ready",
        readyUpdate: verified,
      };

      await this.nativeBridge.notify({
        title: "Hybrid Model Switcher update ready",
        body: `Version ${verified.version} is verified and ready to install.`,
        severity: "info",
      });

      const decision = await this.nativeBridge.promptForRestart(verified);
      if (decision === "accepted") {
        await this.nativeBridge.installAndRestart(verified);
      }

      return this.snapshot;
    } catch (error) {
      const message = getErrorMessage(error);
      this.snapshot = {
        ...this.snapshot,
        state: "failed",
        lastError: message,
      };
      captureTelemetryError(error, {
        code: "updater_check_failed",
        routeKind: "lifecycle:update",
      });
      return this.snapshot;
    }
  }

  private async fetchManifest(): Promise<TauriUpdaterManifest> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await this.fetcher(this.options.manifestUrl, {
        headers: {
          accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new RouterConnectionError("Updater manifest request failed.", {
          status: response.status,
          statusText: response.statusText,
        });
      }

      return parseUpdateManifest(await response.json());
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RouterConnectionError("Updater manifest request timed out.", {
          timeoutMs: this.fetchTimeoutMs,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class TauriNativeUpdateBridge implements NativeUpdateBridge {
  constructor(private readonly core: TauriCore | undefined = detectTauriCore()) {}

  async downloadAndVerify(update: VerifiedUpdate): Promise<VerifiedUpdate> {
    if (!this.core) {
      throw new ConfigurationError(
        "Tauri native updater IPC is unavailable; cannot verify update binary.",
      );
    }

    return this.core.invoke<VerifiedUpdate>("hybrid_updater_download_and_verify", {
      update,
    });
  }

  async promptForRestart(update: VerifiedUpdate): Promise<"accepted" | "dismissed"> {
    if (!this.core) {
      throw new ConfigurationError(
        "Tauri native updater IPC is unavailable; cannot prompt for restart.",
      );
    }

    return this.core.invoke<"accepted" | "dismissed">("hybrid_updater_prompt_restart", {
      update,
    });
  }

  async installAndRestart(update: VerifiedUpdate): Promise<void> {
    if (!this.core) {
      throw new ConfigurationError(
        "Tauri native updater IPC is unavailable; cannot install update.",
      );
    }

    await this.core.invoke<void>("hybrid_updater_install_and_restart", { update });
  }

  async notify(message: NativeNotification): Promise<void> {
    if (!this.core) {
      captureTelemetryMessage(message.title, message.severity, {
        code: "native_notification_unavailable",
        routeKind: "lifecycle:update",
      });
      return;
    }

    await this.core.invoke<void>("hybrid_notify", { message });
  }
}

export function parseUpdateManifest(raw: unknown): TauriUpdaterManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigurationError(
      "Updater manifest failed schema validation.",
      parsed.error.flatten(),
    );
  }

  return parsed.data as TauriUpdaterManifest;
}

export function selectUpdateForPlatform(
  manifest: TauriUpdaterManifest,
  platform: UpdatePlatform,
  currentVersion: string,
): VerifiedUpdate | undefined {
  if (compareSemver(manifest.version, currentVersion) <= 0) {
    return undefined;
  }

  const platformUpdate = manifest.platforms[platform];
  if (!platformUpdate) {
    throw new ConfigurationError("Updater manifest does not contain this platform.", {
      platform,
      available: Object.keys(manifest.platforms),
    });
  }

  return {
    version: manifest.version,
    platform,
    url: platformUpdate.url,
    signature: platformUpdate.signature,
    notes: manifest.notes,
    pubDate: manifest.pub_date,
    verifiedAt: new Date().toISOString(),
  };
}

export function detectUpdatePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): UpdatePlatform {
  if (platform === "win32" && arch === "x64") {
    return "windows-x86_64";
  }

  if (platform === "darwin" && arch === "arm64") {
    return "darwin-aarch64";
  }

  if (platform === "darwin" && arch === "x64") {
    return "darwin-x86_64";
  }

  if (platform === "linux" && arch === "x64") {
    return "linux-x86_64";
  }

  throw new ConfigurationError("Unsupported updater platform.", { platform, arch });
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemverCore(left);
  const rightParts = parseSemverCore(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function parseSemverCore(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(/[+-]/)[0]?.split(".") ?? [];
  return [
    Number.parseInt(major, 10) || 0,
    Number.parseInt(minor, 10) || 0,
    Number.parseInt(patch, 10) || 0,
  ];
}

function detectTauriCore(): TauriCore | undefined {
  const candidate = globalThis as typeof globalThis & {
    __TAURI__?: {
      core?: TauriCore;
    };
  };

  return candidate.__TAURI__?.core;
}

export type UpdatePlatform = "windows-x86_64" | "darwin-x86_64" | "darwin-aarch64" | "linux-x86_64";
export type UpdateMonitorState = "idle" | "checking" | "downloading" | "verified_ready" | "deferred_active_sessions" | "failed" | "stopped";
export interface TauriUpdaterManifest {
    version: string;
    notes?: string;
    pub_date?: string;
    platforms: Record<UpdatePlatform, {
        url: string;
        signature: string;
    }>;
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
export declare class TauriUpdateMonitor {
    private readonly options;
    private readonly fetcher;
    private readonly nativeBridge;
    private readonly platform;
    private readonly checkIntervalMs;
    private readonly fetchTimeoutMs;
    private timer;
    private inFlight;
    private snapshot;
    constructor(options: UpdateMonitorOptions);
    getStatus(): Readonly<UpdateStatusSnapshot>;
    start(): void;
    stop(): void;
    checkNow(): Promise<UpdateStatusSnapshot>;
    installReadyUpdate(): Promise<void>;
    private runCheck;
    private fetchManifest;
}
export declare class TauriNativeUpdateBridge implements NativeUpdateBridge {
    private readonly core;
    constructor(core?: TauriCore | undefined);
    downloadAndVerify(update: VerifiedUpdate): Promise<VerifiedUpdate>;
    promptForRestart(update: VerifiedUpdate): Promise<"accepted" | "dismissed">;
    installAndRestart(update: VerifiedUpdate): Promise<void>;
    notify(message: NativeNotification): Promise<void>;
}
export declare function parseUpdateManifest(raw: unknown): TauriUpdaterManifest;
export declare function selectUpdateForPlatform(manifest: TauriUpdaterManifest, platform: UpdatePlatform, currentVersion: string): VerifiedUpdate | undefined;
export declare function detectUpdatePlatform(platform?: NodeJS.Platform, arch?: NodeJS.Architecture): UpdatePlatform;
export {};

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalConfigRollbackEngine,
  type NativeRollbackNotifier,
} from "../src/lifecycle/rollback.js";
import {
  TauriUpdateMonitor,
  parseUpdateManifest,
  selectUpdateForPlatform,
  type NativeUpdateBridge,
  type VerifiedUpdate,
} from "../src/lifecycle/updater.js";
import {
  classifyUnhandledException,
  createSourceMapReleasePlan,
} from "../src/lifecycle/sentry-triage.js";
import { normalizeAnthropicRouteArgs } from "../src/routing/compatibility.js";
import { ClaudeDesktopHostConfigManager } from "../src/tauri/config.js";
import { RouterConnectionError } from "../src/utils/errors.js";

describe("phase 5 lifecycle operations", () => {
  it("validates updater manifests and defers downloads during active sessions", async () => {
    const manifest = parseUpdateManifest({
      version: "0.2.1",
      notes: "release",
      pub_date: "2026-05-29T00:00:00Z",
      platforms: {
        "windows-x86_64": {
          url: "https://example.com/app.msi.zip",
          signature: "MEUCIEg35RxPhLUFwjDbDLg9P19KdkQAnGeCHFpI3wGNWf2PAiEAzQgo37tJNgUM3MFr7d0pJ9HMG45uAnb99GMmnYxz7nw=",
        },
        "darwin-x86_64": {
          url: "https://example.com/app-x64.dmg.tar.gz",
          signature: "MEQCIFb1UTiGzC6ECx7l9EexGwvAEwUPGRnduHaWiSTP5DCJAiAUXJODCOOUOFlbn86El3BlxMT1dJvdUQYVdKVKp85bPg==",
        },
        "darwin-aarch64": {
          url: "https://example.com/app-arm64.dmg.tar.gz",
          signature: "MEQCIB5FqLM6HvgH4Gs2rTmc9CqUr6CM3zF4fRDcpbFq56VdAiBvyFZI9UHphNFaWPwZx8nnrGQjOLLSZdbMNgDRu70bjA==",
        },
        "linux-x86_64": {
          url: "https://example.com/app.AppImage.tar.gz",
          signature: "MEYCIQCF14JLLeqkWw6Pcs8yVTaMaYCvoTVgTKmPtvUn8B9nOQIhAM4ZxB26j1Blpnor0r9VeIhZmGHq84cQeJK23cn8X3vH",
        },
      },
    });

    const selected = selectUpdateForPlatform(manifest, "windows-x86_64", "0.2.0");
    expect(selected).toMatchObject({
      version: "0.2.1",
      platform: "windows-x86_64",
    });

    let downloadCalled = false;
    const monitor = new TauriUpdateMonitor({
      manifestUrl: "https://updates.example.com/manifest.json",
      currentVersion: "0.2.0",
      platform: "windows-x86_64",
      activeSessionProbe: {
        async hasActiveToolCallingSessions() {
          return true;
        },
      },
      fetcher: async () => Response.json(manifest),
      nativeBridge: {
        async downloadAndVerify(update: VerifiedUpdate) {
          downloadCalled = true;
          return update;
        },
        async promptForRestart() {
          return "dismissed";
        },
        async installAndRestart() {
          throw new Error("should not install while active");
        },
        async notify() {
          return undefined;
        },
      } satisfies NativeUpdateBridge,
    });

    await expect(monitor.checkNow()).resolves.toMatchObject({
      state: "deferred_active_sessions",
    });
    expect(downloadCalled).toBe(false);
  });

  it("snapshots config and restores it after three failed boots", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "phase5-rollback-"));
    const configPath = path.join(directory, "claude_desktop_config.json");
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ mcpServers: { existing: { command: "node" } } }, null, 2)}\n`,
      "utf8",
    );

    const notifications: string[] = [];
    const notifier: NativeRollbackNotifier = {
      async notify(message) {
        notifications.push(message.title);
      },
    };
    const engine = new LocalConfigRollbackEngine({
      hostConfigManager: new ClaudeDesktopHostConfigManager({
        explicitConfigPath: configPath,
        homeDir: directory,
      }),
      proxyServerName: "hybrid-model-switcher",
      stateDirectory: path.join(directory, "rollback-state"),
      notifier,
    });

    const snapshot = await engine.installProxyServerBlock({
      command: "node",
      args: ["dist/index.js"],
    });
    const modified = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(modified.mcpServers["hybrid-model-switcher"]).toBeDefined();
    expect(snapshot.sha256).toHaveLength(64);

    await engine.recordBootStartAndRollbackIfNeeded();
    await engine.recordBootStartAndRollbackIfNeeded();
    const result = await engine.recordBootStartAndRollbackIfNeeded();
    const restored = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };

    expect(result.rolledBack).toBe(true);
    expect(restored.mcpServers["hybrid-model-switcher"]).toBeUndefined();
    expect(restored.mcpServers.existing).toBeDefined();
    expect(notifications).toHaveLength(1);
  });

  it("classifies crashes and builds source map release workflow metadata", () => {
    const transient = classifyUnhandledException(
      new RouterConnectionError("LiteLLM is offline."),
    );
    const fatal = classifyUnhandledException(new Error("Unhandled rejection: heap limit"));
    const plan = createSourceMapReleasePlan({
      release: "hybrid-model-switcher@0.2.1",
    });

    expect(transient).toMatchObject({
      severity: "Warning",
      retryable: true,
    });
    expect(fatal).toMatchObject({
      severity: "Fatal",
      retryable: false,
    });
    expect(plan.uploadCommand).toContain("--release hybrid-model-switcher@0.2.1");
    expect(plan.privacyControls.join(" ")).toContain("redacts local paths");
  });

  it("normalizes legacy Anthropic route arguments", () => {
    const normalized = normalizeAnthropicRouteArgs({
      payload: {
        maxTokens: "128",
        stopSequences: "DONE",
        systemPrompt: "You are concise.",
        messages: "Explain compatibility.",
      },
      model: "qwen3:latest",
      fallbackModel: "phi4:latest",
    });

    expect(normalized).toMatchObject({
      modelOverride: "qwen3:latest",
      fallbackModelOverride: "phi4:latest",
      request: {
        max_tokens: 128,
        stop_sequences: ["DONE"],
        system: "You are concise.",
        messages: [{ role: "user", content: "Explain compatibility." }],
      },
    });
  });
});

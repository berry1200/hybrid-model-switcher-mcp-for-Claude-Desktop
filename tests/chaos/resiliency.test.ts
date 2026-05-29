import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeDesktopHostConfigManager } from "../../src/tauri/config.js";
import { RouterConnectionError, safeToolErrorResult } from "../../src/utils/errors.js";
import {
  buildRecoveryPlan,
  createDegradationSchema,
  createFallbackUiNotification,
} from "../../src/utils/resilience.js";
import { collectGuardedTextStream } from "../../src/utils/streamGuard.js";

describe("chaos resiliency", () => {
  it("degrades safely when the local LLM crashes mid-stream", async () => {
    async function* crashingStream(): AsyncGenerator<string> {
      yield "{\"delta\":\"partial\"}";
      throw new RouterConnectionError("Local LLM connection reset mid-stream.");
    }

    await expect(collectGuardedTextStream(crashingStream())).rejects.toThrow(
      RouterConnectionError,
    );

    const degradation = createDegradationSchema(
      "local_stream_interrupted",
      new RouterConnectionError("Local LLM connection reset mid-stream."),
    );
    const notification = createFallbackUiNotification(degradation);
    const toolResult = safeToolErrorResult(
      new RouterConnectionError("Local LLM connection reset mid-stream."),
    );

    expect(degradation).toMatchObject({
      degraded: true,
      mode: "local_stream_interrupted",
      fallbackProvider: "ollama",
      retryable: true,
    });
    expect(notification).toMatchObject({
      type: "hybrid:fallback",
      severity: "warning",
      title: "Local stream interrupted",
    });
    expect(toolResult.isError).toBe(true);
  });

  it("returns a local fallback recovery plan when cloud routing is offline", async () => {
    const attempts: boolean[] = [];
    const plan = await buildRecoveryPlan(
      "cloud_route_offline",
      new RouterConnectionError("Network unreachable."),
      async () => {
        attempts.push(false);
        return false;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1,
        maxDelayMs: 1,
      },
    );

    expect(attempts).toHaveLength(3);
    expect(plan.degraded).toMatchObject({
      mode: "cloud_route_offline",
      fallbackProvider: "ollama",
      retryable: true,
    });
    expect(plan.notification).toMatchObject({
      type: "hybrid:fallback",
      title: "Cloud route offline",
      action:
        "Disable cloud routing temporarily and continue with the active local Ollama/LiteLLM model.",
    });
    expect(plan.reconnect.every((attempt) => attempt.ok === false)).toBe(true);
  });

  it("survives corrupt host config reads with a non-crashing degradation schema", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "corrupt-config-"));
    const configPath = path.join(directory, "claude_desktop_config.json");
    await fs.writeFile(configPath, "{not-json", "utf8");

    const manager = new ClaudeDesktopHostConfigManager({
      explicitConfigPath: configPath,
      homeDir: directory,
    });

    await expect(manager.readConfig()).rejects.toThrow(
      "Claude Desktop config is not valid JSON",
    );

    const degradation = createDegradationSchema(
      "host_config_unavailable",
      new Error("corrupt claude_desktop_config.json"),
    );
    const notification = createFallbackUiNotification(degradation);

    expect(degradation).toMatchObject({
      degraded: true,
      mode: "host_config_unavailable",
      fallbackProvider: "none",
      retryable: false,
    });
    expect(notification).toMatchObject({
      severity: "error",
      title: "Host config unavailable",
    });
  });
});


import { describe, expect, it } from "vitest";
import { HybridMetricsMonitor } from "../src/observability/metrics.js";
import {
  redactSensitiveText,
  sanitizeTelemetryPayload,
} from "../src/observability/telemetry.js";

describe("observability privacy and latency guards", () => {
  it("redacts API keys, local file paths, and prompt payload fields", () => {
    const redactedText = redactSensitiveText(
      "sk-ant-api03-secretsecretsecret C:\\Users\\Berry\\Documents\\prompt.txt /home/berry/project/file.ts",
    );
    const payload = sanitizeTelemetryPayload({
      code: "payload_translation",
      prompt: "never leave this machine",
      nested: {
        text: "developer prompt",
        safeMetric: 42,
      },
    });

    expect(redactedText).not.toContain("sk-ant");
    expect(redactedText).not.toContain("C:\\Users\\Berry");
    expect(redactedText).not.toContain("/home/berry");
    expect(payload).toMatchObject({
      code: "payload_translation",
      prompt: "[REDACTED_INPUT]",
      nested: {
        text: "[REDACTED_INPUT]",
        safeMetric: 42,
      },
    });
  });

  it("dispatches a fallback alert after a slow local rolling latency window", () => {
    const monitor = new HybridMetricsMonitor({
      latencyThresholdMs: 10,
      rollingWindowSize: 3,
      latencyAlertCooldownMs: 0,
    });
    const alerts: string[] = [];
    monitor.onAlert((alert) => {
      alerts.push(alert.degradation.mode);
    });

    for (let index = 0; index < 3; index += 1) {
      monitor.recordRequestDuration({
        routeKind: "tools/call:hybrid_route_anthropic",
        provider: "litellm",
        durationMs: 11,
        status: "success",
      });
    }

    expect(alerts).toEqual(["local_latency_degraded"]);
  });
});

#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { captureClassifiedException } from "./lifecycle/sentry-triage.js";
import { createHybridMcpProxyServer } from "./mcp/server.js";
import { globalMetricsMonitor } from "./observability/metrics.js";
import { initializeTelemetryFromEnv } from "./observability/telemetry.js";
import { OllamaConnector } from "./ollama.js";
import { LiteLlmRouter } from "./routing/litellm.js";
import { HybridRouter } from "./router.js";
import { ModelStateManager } from "./state.js";
import { AtomicActiveModelStateManager, ClaudeDesktopHostConfigManager, } from "./tauri/config.js";
async function main() {
    const telemetry = initializeTelemetryFromEnv();
    globalMetricsMonitor.startHeartbeatLoop();
    const config = loadConfig();
    const ollama = new OllamaConnector(config);
    const state = new ModelStateManager(config);
    const router = new HybridRouter({ config, ollama, state });
    const activeModelState = new AtomicActiveModelStateManager({
        statePath: config.activeModelStatePath,
        defaultModel: config.defaultModel,
    });
    const liteLlmRouter = new LiteLlmRouter(activeModelState, {
        baseUrl: config.liteLlmBaseUrl,
        apiKey: config.liteLlmApiKey,
        timeoutMs: config.requestTimeoutMs,
        localModelPrefix: config.liteLlmModelPrefix,
    });
    const hostConfig = new ClaudeDesktopHostConfigManager();
    const proxyServer = createHybridMcpProxyServer({
        router,
        liteLlmRouter,
        activeModelState,
        hostConfig,
    }, {
        requestTimeoutMs: config.requestTimeoutMs,
    });
    await proxyServer.connectStdio();
    await telemetry.flush();
}
main().catch(async (error) => {
    const telemetry = initializeTelemetryFromEnv();
    const classification = captureClassifiedException(error, {
        routeKind: "startup",
        release: process.env.HYBRID_RELEASE ?? process.env.SENTRY_RELEASE,
        dist: "desktop",
        platform: process.platform,
    });
    telemetry.captureMessage("startup.failure", classification.sentryLevel, {
        code: "startup_failure",
        routeKind: "startup",
    });
    await telemetry.flush();
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
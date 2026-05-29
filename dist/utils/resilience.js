import { ConfigurationError, McpTimeoutError, PayloadTranslationError, RouterConnectionError, getErrorMessage, toHostReadableError, } from "./errors.js";
export async function buildRecoveryPlan(mode, error, probe, options = {}) {
    const reconnect = await attemptReconnect(probe, {
        maxAttempts: options.maxAttempts ?? 3,
        initialDelayMs: options.initialDelayMs ?? 25,
        maxDelayMs: options.maxDelayMs ?? 250,
    });
    const degraded = createDegradationSchema(mode, error);
    return {
        degraded,
        notification: createFallbackUiNotification(degraded),
        reconnect,
    };
}
export function createDegradationSchema(mode, error) {
    const hostError = toHostReadableError(normalizeErrorForMode(mode, error));
    switch (mode) {
        case "local_stream_interrupted":
            return {
                degraded: true,
                mode,
                safeMessage: "The local model stream ended unexpectedly. The proxy kept the MCP connection open and discarded the partial buffer.",
                retryable: true,
                recoveryAction: "Retry the request against the fallback model or wait for the local LLM server to restart.",
                fallbackProvider: "ollama",
                timestamp: new Date().toISOString(),
            };
        case "local_latency_degraded":
            return {
                degraded: true,
                mode,
                safeMessage: "Local model routing latency exceeded the configured rolling threshold. The proxy can keep the MCP connection alive while routing shifts to the configured fallback path.",
                retryable: true,
                recoveryAction: "Switch to the configured fallback model, reduce context size, or wait for the local route to recover.",
                fallbackProvider: "ollama",
                timestamp: new Date().toISOString(),
            };
        case "cloud_route_offline":
            return {
                degraded: true,
                mode,
                safeMessage: hostError.message,
                retryable: true,
                recoveryAction: "Disable cloud routing temporarily and continue with the active local Ollama/LiteLLM model.",
                fallbackProvider: "ollama",
                timestamp: new Date().toISOString(),
            };
        case "host_config_unavailable":
            return {
                degraded: true,
                mode,
                safeMessage: "The host configuration could not be read safely. Existing in-memory model state remains active.",
                retryable: false,
                recoveryAction: "Ask the user to repair claude_desktop_config.json before changing host MCP configuration.",
                fallbackProvider: "none",
                timestamp: new Date().toISOString(),
            };
    }
}
export function createFallbackUiNotification(degradation) {
    const severity = degradation.retryable ? "warning" : "error";
    return {
        type: "hybrid:fallback",
        severity,
        title: titleForMode(degradation.mode),
        body: degradation.safeMessage,
        action: degradation.recoveryAction,
        timestamp: degradation.timestamp,
    };
}
export async function attemptReconnect(probe, options) {
    const attempts = [];
    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
        try {
            const ok = await probe();
            attempts.push({
                attempt,
                ok,
                attemptedAt: new Date().toISOString(),
            });
            if (ok) {
                break;
            }
        }
        catch (error) {
            attempts.push({
                attempt,
                ok: false,
                error: getErrorMessage(error),
                attemptedAt: new Date().toISOString(),
            });
        }
        if (attempt < options.maxAttempts) {
            await sleep(Math.min(options.maxDelayMs, options.initialDelayMs * 2 ** (attempt - 1)));
        }
    }
    return attempts;
}
function normalizeErrorForMode(mode, error) {
    switch (mode) {
        case "cloud_route_offline":
            return new RouterConnectionError("Cloud routing is offline; using local fallback.", {
                cause: getErrorMessage(error),
            });
        case "host_config_unavailable":
            return new ConfigurationError("Host config is unavailable.", {
                cause: getErrorMessage(error),
            });
        case "local_stream_interrupted":
            return new PayloadTranslationError("Local model stream ended early.", {
                cause: getErrorMessage(error),
            });
        case "local_latency_degraded":
            return new McpTimeoutError("Local route latency is degraded.", {
                cause: getErrorMessage(error),
            });
    }
}
function titleForMode(mode) {
    switch (mode) {
        case "local_stream_interrupted":
            return "Local stream interrupted";
        case "local_latency_degraded":
            return "Local route latency degraded";
        case "cloud_route_offline":
            return "Cloud route offline";
        case "host_config_unavailable":
            return "Host config unavailable";
    }
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
//# sourceMappingURL=resilience.js.map
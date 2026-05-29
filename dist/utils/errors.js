export class HybridModelError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "HybridModelError";
    }
}
export class McpTimeoutError extends HybridModelError {
    constructor(message, details) {
        super("mcp_timeout", message, details);
        this.name = "McpTimeoutError";
    }
}
export class RouterConnectionError extends HybridModelError {
    constructor(message, details) {
        super("router_connection", message, details);
        this.name = "RouterConnectionError";
    }
}
export class PayloadTranslationError extends HybridModelError {
    constructor(message, details) {
        super("payload_translation", message, details);
        this.name = "PayloadTranslationError";
    }
}
export class ConfigurationError extends HybridModelError {
    constructor(message, details) {
        super("configuration_error", message, details);
        this.name = "ConfigurationError";
    }
}
export function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return "Unknown error";
    }
}
export function toHostReadableError(error) {
    if (error instanceof McpTimeoutError) {
        return {
            code: error.code,
            message: error.message,
            hint: "The local route timed out. Try a smaller prompt, a faster local model, or increase HYBRID_REQUEST_TIMEOUT_MS.",
            retryable: true,
            details: error.details,
        };
    }
    if (error instanceof RouterConnectionError) {
        return {
            code: error.code,
            message: error.message,
            hint: "The local routing gateway is unavailable. Check that LiteLLM/Ollama is running and reachable.",
            retryable: true,
            details: error.details,
        };
    }
    if (error instanceof PayloadTranslationError) {
        return {
            code: error.code,
            message: error.message,
            hint: "The request could not be translated safely for the selected local model. Remove unsupported content blocks or tools and retry.",
            retryable: false,
            details: error.details,
        };
    }
    if (error instanceof ConfigurationError) {
        return {
            code: error.code,
            message: error.message,
            hint: "Check the Claude Desktop config path and the hybrid model state file permissions.",
            retryable: false,
            details: error.details,
        };
    }
    if (error instanceof HybridModelError) {
        return {
            code: error.code,
            message: error.message,
            hint: "The hybrid model proxy handled this error without closing the MCP connection.",
            retryable: false,
            details: error.details,
        };
    }
    return {
        code: "unknown_error",
        message: getErrorMessage(error),
        hint: "The hybrid model proxy handled an unexpected error safely.",
        retryable: false,
    };
}
export function safeToolErrorResult(error) {
    const hostError = toHostReadableError(error);
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: `${hostError.message}\n\n${hostError.hint}`,
            },
        ],
        structuredContent: {
            error: hostError,
        },
    };
}
export async function withTimeout(operation, timeoutMs, message) {
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            reject(new McpTimeoutError(message, { timeoutMs }));
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, timeoutPromise]);
    }
    finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}
export function parseLocalLlmFailure(error) {
    if (error instanceof HybridModelError) {
        return error;
    }
    const message = getErrorMessage(error);
    const lower = message.toLowerCase();
    if (lower.includes("timeout") ||
        lower.includes("timed out") ||
        lower.includes("abort")) {
        return new McpTimeoutError("Local model request timed out.", { cause: message });
    }
    if (lower.includes("econnrefused") ||
        lower.includes("connection refused") ||
        lower.includes("fetch failed") ||
        lower.includes("failed to fetch") ||
        lower.includes("could not reach")) {
        return new RouterConnectionError("The local model gateway is not reachable.", { cause: message });
    }
    if (lower.includes("context length") ||
        lower.includes("maximum context") ||
        lower.includes("num_ctx") ||
        lower.includes("too many tokens") ||
        lower.includes("prompt too long")) {
        return new PayloadTranslationError("The request exceeds the selected local model context window.", { cause: message });
    }
    return new HybridModelError("hybrid_model_error", message, { cause: error });
}
//# sourceMappingURL=errors.js.map
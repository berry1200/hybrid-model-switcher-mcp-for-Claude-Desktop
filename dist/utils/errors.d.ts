import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export type HybridErrorCode = "hybrid_model_error" | "mcp_timeout" | "router_connection" | "payload_translation" | "configuration_error" | "unknown_error";
export declare class HybridModelError extends Error {
    readonly code: HybridErrorCode | string;
    readonly details?: unknown | undefined;
    constructor(code: HybridErrorCode | string, message: string, details?: unknown | undefined);
}
export declare class McpTimeoutError extends HybridModelError {
    constructor(message: string, details?: unknown);
}
export declare class RouterConnectionError extends HybridModelError {
    constructor(message: string, details?: unknown);
}
export declare class PayloadTranslationError extends HybridModelError {
    constructor(message: string, details?: unknown);
}
export declare class ConfigurationError extends HybridModelError {
    constructor(message: string, details?: unknown);
}
export interface HostReadableError {
    code: HybridErrorCode | string;
    message: string;
    hint: string;
    retryable: boolean;
    details?: unknown;
}
export declare function getErrorMessage(error: unknown): string;
export declare function toHostReadableError(error: unknown): HostReadableError;
export declare function safeToolErrorResult(error: unknown): CallToolResult;
export declare function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T>;
export declare function parseLocalLlmFailure(error: unknown): HybridModelError;

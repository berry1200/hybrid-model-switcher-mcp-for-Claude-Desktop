import type { AnthropicMessagesRequest } from "./litellm.js";
import type { ActiveLocalModelState } from "../tauri/config.js";
export declare const CURRENT_COMPATIBILITY_SCHEMA_VERSION = 2;
export interface HybridRuntimeConfigV2 {
    schemaVersion: 2;
    endpoints: {
        ollamaBaseUrl: string;
        liteLlmBaseUrl: string;
    };
    routing: {
        provider: "ollama" | "litellm" | "client";
        model?: string;
        litellmModel?: string;
        fallbackModel?: string;
        autoFallback: boolean;
    };
    updatedAt: string;
}
export interface NormalizedAnthropicRouteArgs {
    request: AnthropicMessagesRequest;
    modelOverride?: string;
    fallbackModelOverride?: string;
}
export declare function migrateRuntimeConfig(raw: unknown, defaults: {
    ollamaBaseUrl: string;
    liteLlmBaseUrl: string;
    defaultModel?: string;
}): HybridRuntimeConfigV2;
export declare function migrateActiveModelState(raw: unknown): ActiveLocalModelState;
export declare function normalizeAnthropicRouteArgs(raw: unknown): NormalizedAnthropicRouteArgs;
export declare function normalizeAnthropicMessagesRequest(raw: Record<string, unknown>): AnthropicMessagesRequest;
export declare function normalizeLiteLlmMetadata(metadata: unknown, routing: {
    provider: string;
    activeModel?: string;
    litellmModel?: string;
    revision?: number;
}): Record<string, unknown>;

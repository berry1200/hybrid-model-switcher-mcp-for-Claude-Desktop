import * as z from "zod/v4";
import type { ActiveLocalModelState } from "../tauri/config.js";
export declare const anthropicMessagesRequestSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
    max_tokens: z.ZodOptional<z.ZodNumber>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$catchall<z.ZodUnknown>>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            source: z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"base64">;
                media_type: z.ZodString;
                data: z.ZodString;
            }, z.core.$catchall<z.ZodUnknown>>, z.ZodObject<{
                type: z.ZodLiteral<"url">;
                url: z.ZodString;
            }, z.core.$catchall<z.ZodUnknown>>]>;
        }, z.core.$catchall<z.ZodUnknown>>]>>]>;
    }, z.core.$catchall<z.ZodUnknown>>>;
    system: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$catchall<z.ZodUnknown>>>]>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    stop_sequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
    stream: z.ZodOptional<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    tools: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    tool_choice: z.ZodOptional<z.ZodUnknown>;
}, z.core.$catchall<z.ZodUnknown>>;
export type AnthropicMessagesRequest = z.infer<typeof anthropicMessagesRequestSchema>;
export interface LiteLlmRouterConfig {
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
    localModelPrefix?: string;
}
export interface ActiveModelSnapshotProvider {
    getRequiredSnapshot(): Promise<Readonly<ActiveLocalModelState>>;
}
export interface LiteLlmDispatchOptions {
    modelOverride?: string;
    fallbackModelOverride?: string;
}
export interface LiteLlmDispatchResult {
    provider: "litellm";
    model: string;
    activeModel: string;
    revision: number;
    text: string;
    raw: unknown;
    fallbackUsed: boolean;
}
export interface McpLifecycleForwardResult {
    ok: boolean;
    status?: number;
}
interface OpenAiTextContent {
    type: "text";
    text: string;
}
interface OpenAiImageContent {
    type: "image_url";
    image_url: {
        url: string;
    };
}
type OpenAiMessageContent = string | Array<OpenAiTextContent | OpenAiImageContent>;
interface OpenAiChatMessage {
    role: "system" | "user" | "assistant";
    content: OpenAiMessageContent;
}
interface LiteLlmChatPayload {
    model: string;
    messages: OpenAiChatMessage[];
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop?: string[];
    stream: false;
    metadata: Record<string, unknown>;
}
export interface OllamaChatPayload {
    model: string;
    messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
        images?: string[];
    }>;
    stream: false;
    options?: {
        temperature?: number;
        top_p?: number;
        num_predict?: number;
        stop?: string[];
    };
}
export declare class LiteLlmRouter {
    private readonly activeModelState;
    private readonly config;
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly localModelPrefix;
    constructor(activeModelState: ActiveModelSnapshotProvider, config?: LiteLlmRouterConfig);
    dispatchAnthropic(request: AnthropicMessagesRequest, options?: LiteLlmDispatchOptions): Promise<LiteLlmDispatchResult>;
    dispatchTranslatedPayload(payload: LiteLlmChatPayload, snapshot: Readonly<ActiveLocalModelState>, fallbackUsed: boolean): Promise<LiteLlmDispatchResult>;
    forwardMcpLifecycleEvent(method: "tools/list" | "tools/call", request: {
        method: string;
        params?: unknown;
    }): Promise<McpLifecycleForwardResult>;
    private parseRequest;
    private resolveModel;
    private fetchJson;
    private fetchRaw;
    private headers;
}
export declare function translateAnthropicToLiteLlm(request: AnthropicMessagesRequest, snapshot: Readonly<ActiveLocalModelState>, model: string): LiteLlmChatPayload;
export declare function translateAnthropicToOllamaChat(request: AnthropicMessagesRequest, model: string): OllamaChatPayload;
export {};

export declare const PROVIDERS: readonly ["ollama", "client"];
export type Provider = (typeof PROVIDERS)[number];
export type ChatRole = "system" | "user" | "assistant";
export interface AppConfig {
    ollamaBaseUrl: string;
    liteLlmBaseUrl: string;
    liteLlmApiKey?: string;
    liteLlmModelPrefix?: string;
    statePath: string;
    activeModelStatePath: string;
    requestTimeoutMs: number;
    defaultModel?: string;
}
export interface HybridState {
    provider: Provider;
    model?: string;
    autoFallback: boolean;
    updatedAt: string;
}
export interface OllamaModel {
    name: string;
    modifiedAt?: string;
    size?: number;
    digest?: string;
    family?: string;
    families?: string[];
    parameterSize?: string;
    quantizationLevel?: string;
}
export interface ChatMessage {
    role: ChatRole;
    content: string;
}
export interface GenerationOptions {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_ctx?: number;
    num_predict?: number;
    stop?: string[];
}
export interface GenerationRequest {
    prompt: string;
    system?: string;
    provider?: Provider;
    model?: string;
    options?: GenerationOptions;
}
export interface ChatRequest {
    messages: ChatMessage[];
    provider?: Provider;
    model?: string;
    options?: GenerationOptions;
}
export interface GenerationResult {
    provider: Provider;
    model?: string;
    text: string;
    elapsedMs: number;
    fallbackUsed?: boolean;
    warning?: string;
    raw?: unknown;
}
export interface ModelRecommendation {
    taskType: string;
    displayName: string;
    modelName: string;
    reason: string;
    ollamaPull: string;
}
export interface ProviderSelection {
    provider: Provider;
    model?: string;
}

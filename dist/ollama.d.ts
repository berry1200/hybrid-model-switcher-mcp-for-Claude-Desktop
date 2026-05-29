import type { AppConfig, ChatMessage, GenerationOptions, OllamaModel } from "./types.js";
interface OllamaGenerateResponse {
    model?: string;
    response?: string;
    done?: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    eval_count?: number;
}
interface OllamaChatResponse {
    model?: string;
    message?: {
        role?: string;
        content?: string;
    };
    done?: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    eval_count?: number;
}
export declare class OllamaConnector {
    private readonly config;
    constructor(config: Pick<AppConfig, "ollamaBaseUrl" | "requestTimeoutMs">);
    health(): Promise<{
        ok: boolean;
        baseUrl: string;
        error?: string;
    }>;
    listModels(): Promise<OllamaModel[]>;
    generate(input: {
        model: string;
        prompt: string;
        system?: string;
        options?: GenerationOptions;
    }): Promise<{
        text: string;
        model?: string;
        raw: OllamaGenerateResponse;
    }>;
    chat(input: {
        model: string;
        messages: ChatMessage[];
        options?: GenerationOptions;
    }): Promise<{
        text: string;
        model?: string;
        raw: OllamaChatResponse;
    }>;
    streamGenerate(input: {
        model: string;
        prompt: string;
        system?: string;
        options?: GenerationOptions;
    }): AsyncGenerator<string>;
    private request;
    private fetchWithTimeout;
}
export {};

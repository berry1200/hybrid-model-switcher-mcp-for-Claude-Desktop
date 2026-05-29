import type { ModelStateManager } from "./state.js";
import type { AppConfig, ChatRequest, GenerationRequest, GenerationResult, Provider } from "./types.js";
import type { OllamaConnector } from "./ollama.js";
type ClientSampler = (input: {
    messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
    }>;
    model?: string;
    options?: GenerationRequest["options"];
}) => Promise<GenerationResult>;
export declare class HybridRouter {
    private readonly deps;
    constructor(deps: {
        config: AppConfig;
        ollama: OllamaConnector;
        state: ModelStateManager;
    });
    status(): Promise<Record<string, unknown>>;
    listModels(): Promise<Record<string, unknown>>;
    setModel(input: {
        provider?: Provider;
        model?: string;
        autoFallback?: boolean;
    }): Promise<Record<string, unknown>>;
    generate(input: GenerationRequest, clientSampler: ClientSampler): Promise<GenerationResult>;
    chat(input: ChatRequest, clientSampler: ClientSampler): Promise<GenerationResult>;
    private tryClientThenFallback;
    private generateWithOllama;
    private resolveSelection;
    private resolveOllamaModel;
    private assertOllamaModelExists;
}
export {};

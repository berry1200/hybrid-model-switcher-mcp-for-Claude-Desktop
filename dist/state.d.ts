import type { AppConfig, HybridState, Provider } from "./types.js";
export declare class ModelStateManager {
    private readonly config;
    private cachedState;
    constructor(config: Pick<AppConfig, "statePath" | "defaultModel">);
    get(): Promise<HybridState>;
    set(update: {
        provider?: Provider;
        model?: string;
        autoFallback?: boolean;
    }): Promise<HybridState>;
    reset(): Promise<HybridState>;
    private persist;
}

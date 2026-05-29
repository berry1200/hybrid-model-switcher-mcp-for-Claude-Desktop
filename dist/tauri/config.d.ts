import * as z from "zod/v4";
declare const hostMcpServerSchema: z.ZodObject<{
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$catchall<z.ZodUnknown>>;
declare const claudeDesktopConfigSchema: z.ZodObject<{
    mcpServers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        command: z.ZodString;
        args: z.ZodOptional<z.ZodArray<z.ZodString>>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$catchall<z.ZodUnknown>>>>;
}, z.core.$catchall<z.ZodUnknown>>;
export type HostMcpServerConfig = z.infer<typeof hostMcpServerSchema>;
export type ClaudeDesktopConfig = z.infer<typeof claudeDesktopConfigSchema>;
export interface HostConfigManagerOptions {
    explicitConfigPath?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDir?: string;
}
export interface ActiveLocalModelState {
    provider: "ollama" | "litellm" | "client";
    model?: string;
    litellmModel?: string;
    fallbackModel?: string;
    autoFallback: boolean;
    revision: number;
    updatedAt: string;
}
export interface ActiveModelStateManagerOptions {
    statePath: string;
    defaultModel?: string;
    defaultLiteLlmModel?: string;
}
export declare class ClaudeDesktopHostConfigManager {
    private readonly env;
    private readonly platform;
    private readonly homeDir;
    private readonly explicitConfigPath?;
    constructor(options?: HostConfigManagerOptions);
    locateConfigPath(): Promise<string>;
    readConfig(): Promise<ClaudeDesktopConfig>;
    readMcpServer(name: string): Promise<HostMcpServerConfig | undefined>;
    getCandidatePaths(): string[];
    private resolveCandidate;
}
export declare class AtomicActiveModelStateManager {
    private readonly options;
    private queue;
    constructor(options: ActiveModelStateManagerOptions);
    getSnapshot(): Promise<Readonly<ActiveLocalModelState>>;
    getRequiredSnapshot(): Promise<Readonly<ActiveLocalModelState>>;
    setActiveModel(input: {
        model: string;
        provider?: ActiveLocalModelState["provider"];
        litellmModel?: string;
        fallbackModel?: string;
        autoFallback?: boolean;
    }): Promise<Readonly<ActiveLocalModelState>>;
    setAutoFallback(autoFallback: boolean): Promise<Readonly<ActiveLocalModelState>>;
    withModelSnapshot<T>(operation: (snapshot: Readonly<ActiveLocalModelState>) => Promise<T>): Promise<T>;
    private readState;
    private writeState;
    private runExclusive;
}
export {};

import type { ClaudeDesktopHostConfigManager, HostMcpServerConfig } from "../tauri/config.js";
export interface RollbackEngineOptions {
    hostConfigManager: ClaudeDesktopHostConfigManager;
    proxyServerName: string;
    stateDirectory?: string;
    crashThreshold?: number;
    notifier?: NativeRollbackNotifier;
}
export interface ConfigSnapshot {
    snapshotPath: string;
    configPath: string;
    createdAt: string;
    sha256: string;
    bytes: number;
}
export interface BootLoopState {
    consecutiveBootFailures: number;
    lastBootStartedAt?: string;
    lastHealthyAt?: string;
    lastRollbackAt?: string;
    lastRollbackReason?: string;
}
export interface RollbackResult {
    rolledBack: boolean;
    reason: string;
    restoredSnapshotPath?: string;
    configPath?: string;
    notificationSent: boolean;
}
export interface NativeRollbackNotifier {
    notify(message: {
        title: string;
        body: string;
        severity: "info" | "warning" | "error";
    }): Promise<void>;
}
interface TauriCore {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
export declare class LocalConfigRollbackEngine {
    private readonly options;
    private readonly stateDirectory;
    private readonly crashThreshold;
    private readonly notifier;
    constructor(options: RollbackEngineOptions);
    snapshotHostConfig(): Promise<ConfigSnapshot>;
    installProxyServerBlock(serverConfig: HostMcpServerConfig, serverName?: string): Promise<ConfigSnapshot>;
    recordBootStartAndRollbackIfNeeded(reason?: string): Promise<RollbackResult>;
    recordBootHealthy(): Promise<void>;
    rollbackToLatestSnapshot(reason: string): Promise<RollbackResult>;
    private purgeProxyBlockOnly;
    private notifyRollback;
    private readBootState;
    private writeBootState;
    private writeLatestSnapshot;
    private readLatestSnapshot;
    private get bootStatePath();
    private get latestSnapshotPath();
}
export declare class TauriRollbackNotifier implements NativeRollbackNotifier {
    private readonly core;
    constructor(core?: TauriCore | undefined);
    notify(message: {
        title: string;
        body: string;
        severity: "info" | "warning" | "error";
    }): Promise<void>;
}
export declare function atomicWriteJson(filePath: string, value: unknown): Promise<void>;
export declare function atomicWriteFile(filePath: string, bytes: Buffer): Promise<void>;
export {};

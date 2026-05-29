export type DegradationMode = "local_stream_interrupted" | "local_latency_degraded" | "cloud_route_offline" | "host_config_unavailable";
export interface DegradationSchema {
    degraded: true;
    mode: DegradationMode;
    safeMessage: string;
    retryable: boolean;
    recoveryAction: string;
    fallbackProvider: "ollama" | "client" | "none";
    timestamp: string;
}
export interface FallbackUiNotificationSignal {
    type: "hybrid:fallback";
    severity: "info" | "warning" | "error";
    title: string;
    body: string;
    action?: string;
    timestamp: string;
}
export interface RecoveryAttempt {
    attempt: number;
    ok: boolean;
    error?: string;
    attemptedAt: string;
}
export interface RecoveryPlan {
    degraded: DegradationSchema;
    notification: FallbackUiNotificationSignal;
    reconnect: RecoveryAttempt[];
}
export interface ReconnectOptions {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
}
export declare function buildRecoveryPlan(mode: DegradationMode, error: unknown, probe: () => Promise<boolean>, options?: Partial<ReconnectOptions>): Promise<RecoveryPlan>;
export declare function createDegradationSchema(mode: DegradationMode, error: unknown): DegradationSchema;
export declare function createFallbackUiNotification(degradation: DegradationSchema): FallbackUiNotificationSignal;
export declare function attemptReconnect(probe: () => Promise<boolean>, options: ReconnectOptions): Promise<RecoveryAttempt[]>;

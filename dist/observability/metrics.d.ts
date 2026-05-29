import { type DegradationSchema, type FallbackUiNotificationSignal } from "../utils/resilience.js";
export declare const REQUEST_DURATION_METRIC: "McpProxy_Request_To_Response_Duration";
export type RouteProvider = "ollama" | "litellm" | "client" | "unknown";
export type MetricStatus = "success" | "failed";
export interface RequestDurationSample {
    metric: typeof REQUEST_DURATION_METRIC;
    routeKind: string;
    provider: RouteProvider;
    model?: string;
    durationMs: number;
    status: MetricStatus;
    timestamp: string;
    errorCode?: string;
}
export interface RequestTrackingMetadata {
    routeKind: string;
    provider?: RouteProvider;
    model?: string;
}
export interface RequestClassification {
    status: MetricStatus;
    errorCode?: string;
}
export interface LatencyStats {
    count: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    lastMs: number;
}
export interface RoutingSwitchMetrics {
    success: number;
    failed: number;
    last?: {
        status: MetricStatus;
        from?: string;
        to?: string;
        errorCode?: string;
        timestamp: string;
    };
}
export interface SystemDiagnosticSnapshot {
    generatedAt: string;
    cpu: {
        logicalCores: number;
        processCpuPercent: number;
        loadAverage1m?: number;
    };
    memory: {
        rssBytes: number;
        heapUsedBytes: number;
        heapTotalBytes: number;
        externalBytes: number;
        arrayBuffersBytes: number;
        systemFreeBytes: number;
        systemTotalBytes: number;
    };
    requests: {
        total: number;
        failed: number;
        latency?: LatencyStats;
    };
    routingSwitches: RoutingSwitchMetrics;
}
export interface MetricAlert {
    type: "hybrid:metric_alert";
    severity: "warning";
    title: string;
    body: string;
    degradation: DegradationSchema;
    notification: FallbackUiNotificationSignal;
    rollingWindow: RequestDurationSample[];
    timestamp: string;
}
export interface HybridMetricsMonitorOptions {
    latencyThresholdMs: number;
    rollingWindowSize: number;
    maxSamples: number;
    heartbeatIntervalMs: number;
    latencyAlertCooldownMs: number;
    emitTelemetryHeartbeats: boolean;
}
type AlertListener = (alert: MetricAlert) => void | Promise<void>;
export declare class HybridMetricsMonitor {
    private readonly options;
    private readonly samples;
    private readonly localLatencyWindow;
    private readonly listeners;
    private readonly routingSwitches;
    private lastCpuUsage;
    private lastCpuMeasuredAt;
    private lastLatencyAlertAt;
    private heartbeatTimer;
    constructor(options?: Partial<HybridMetricsMonitorOptions>);
    trackRequest<T>(metadata: RequestTrackingMetadata, operation: () => Promise<T>, classifyResult?: (result: T) => RequestClassification): Promise<T>;
    recordRequestDuration(sample: Omit<RequestDurationSample, "metric" | "timestamp" | "provider"> & {
        provider?: RouteProvider;
    }): RequestDurationSample;
    recordModelSwitch(input: {
        status: MetricStatus;
        from?: string;
        to?: string;
        errorCode?: string;
    }): void;
    getLatencyStats(filter?: {
        routeKind?: string;
        provider?: RouteProvider;
    }): LatencyStats | undefined;
    snapshotSystemDiagnostics(): SystemDiagnosticSnapshot;
    startHeartbeatLoop(): void;
    stopHeartbeatLoop(): void;
    onAlert(listener: AlertListener): () => void;
    private maybeDispatchLatencyAlert;
    private dispatchAlert;
    private measureCpu;
}
export declare const globalMetricsMonitor: HybridMetricsMonitor;
export {};

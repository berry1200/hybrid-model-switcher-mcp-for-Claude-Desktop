import os from "node:os";
import { performance } from "node:perf_hooks";
import { captureTelemetryError, captureTelemetryMessage } from "./telemetry.js";
import { HybridModelError, McpTimeoutError } from "../utils/errors.js";
import {
  createDegradationSchema,
  createFallbackUiNotification,
  type DegradationSchema,
  type FallbackUiNotificationSignal,
} from "../utils/resilience.js";

export const REQUEST_DURATION_METRIC =
  "McpProxy_Request_To_Response_Duration" as const;

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

const DEFAULT_OPTIONS: HybridMetricsMonitorOptions = {
  latencyThresholdMs: 2_500,
  rollingWindowSize: 3,
  maxSamples: 1_000,
  heartbeatIntervalMs: 30_000,
  latencyAlertCooldownMs: 60_000,
  emitTelemetryHeartbeats: false,
};

export class HybridMetricsMonitor {
  private readonly options: HybridMetricsMonitorOptions;
  private readonly samples: RequestDurationSample[] = [];
  private readonly localLatencyWindow: RequestDurationSample[] = [];
  private readonly listeners = new Set<AlertListener>();
  private readonly routingSwitches: RoutingSwitchMetrics = {
    success: 0,
    failed: 0,
  };
  private lastCpuUsage = process.cpuUsage();
  private lastCpuMeasuredAt = performance.now();
  private lastLatencyAlertAt = 0;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(options: Partial<HybridMetricsMonitorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async trackRequest<T>(
    metadata: RequestTrackingMetadata,
    operation: () => Promise<T>,
    classifyResult: (result: T) => RequestClassification = () => ({
      status: "success",
    }),
  ): Promise<T> {
    const startedAt = performance.now();

    try {
      const result = await operation();
      this.recordRequestDuration({
        ...metadata,
        durationMs: performance.now() - startedAt,
        ...classifyResult(result),
      });
      return result;
    } catch (error) {
      const errorCode = errorCodeFromUnknown(error);
      this.recordRequestDuration({
        ...metadata,
        durationMs: performance.now() - startedAt,
        status: "failed",
        errorCode,
      });
      captureTelemetryError(error, {
        code: errorCode,
        routeKind: metadata.routeKind,
        provider: metadata.provider,
        model: metadata.model,
      });
      throw error;
    }
  }

  recordRequestDuration(
    sample: Omit<RequestDurationSample, "metric" | "timestamp" | "provider"> & {
      provider?: RouteProvider;
    },
  ): RequestDurationSample {
    const normalized: RequestDurationSample = {
      metric: REQUEST_DURATION_METRIC,
      routeKind: sample.routeKind,
      provider: sample.provider ?? "unknown",
      model: sample.model,
      durationMs: Math.max(0, sample.durationMs),
      status: sample.status,
      timestamp: new Date().toISOString(),
      errorCode: sample.errorCode,
    };

    this.samples.push(normalized);
    if (this.samples.length > this.options.maxSamples) {
      this.samples.splice(0, this.samples.length - this.options.maxSamples);
    }

    if (normalized.provider === "ollama" || normalized.provider === "litellm") {
      this.localLatencyWindow.push(normalized);
      if (this.localLatencyWindow.length > this.options.rollingWindowSize) {
        this.localLatencyWindow.shift();
      }
      this.maybeDispatchLatencyAlert();
    }

    return normalized;
  }

  recordModelSwitch(input: {
    status: MetricStatus;
    from?: string;
    to?: string;
    errorCode?: string;
  }): void {
    this.routingSwitches[input.status] += 1;
    this.routingSwitches.last = {
      status: input.status,
      from: input.from,
      to: input.to,
      errorCode: input.errorCode,
      timestamp: new Date().toISOString(),
    };
  }

  getLatencyStats(filter?: {
    routeKind?: string;
    provider?: RouteProvider;
  }): LatencyStats | undefined {
    const values = this.samples
      .filter((sample) => !filter?.routeKind || sample.routeKind === filter.routeKind)
      .filter((sample) => !filter?.provider || sample.provider === filter.provider)
      .map((sample) => sample.durationMs)
      .sort((left, right) => left - right);

    if (values.length === 0) {
      return undefined;
    }

    const sum = values.reduce((total, value) => total + value, 0);

    return {
      count: values.length,
      minMs: values[0] ?? 0,
      maxMs: values[values.length - 1] ?? 0,
      avgMs: sum / values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      lastMs: this.samples[this.samples.length - 1]?.durationMs ?? 0,
    };
  }

  snapshotSystemDiagnostics(): SystemDiagnosticSnapshot {
    const memory = process.memoryUsage();
    const failed = this.samples.filter((sample) => sample.status === "failed").length;

    return {
      generatedAt: new Date().toISOString(),
      cpu: this.measureCpu(),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        systemFreeBytes: os.freemem(),
        systemTotalBytes: os.totalmem(),
      },
      requests: {
        total: this.samples.length,
        failed,
        latency: this.getLatencyStats(),
      },
      routingSwitches: { ...this.routingSwitches },
    };
  }

  startHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      const snapshot = this.snapshotSystemDiagnostics();
      if (this.options.emitTelemetryHeartbeats) {
        captureTelemetryMessage("hybrid.metrics.heartbeat", "info", {
          metrics: flattenDiagnosticSnapshot(snapshot),
        });
      }
    }, this.options.heartbeatIntervalMs);

    this.heartbeatTimer.unref();
  }

  stopHeartbeatLoop(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  onAlert(listener: AlertListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private maybeDispatchLatencyAlert(): void {
    if (this.localLatencyWindow.length < this.options.rollingWindowSize) {
      return;
    }

    const allSlow = this.localLatencyWindow.every(
      (sample) => sample.durationMs >= this.options.latencyThresholdMs,
    );
    if (!allSlow) {
      return;
    }

    const now = Date.now();
    if (now - this.lastLatencyAlertAt < this.options.latencyAlertCooldownMs) {
      return;
    }

    this.lastLatencyAlertAt = now;
    const error = new McpTimeoutError(
      "Local routing latency exceeded the configured rolling threshold.",
      {
        thresholdMs: this.options.latencyThresholdMs,
        rollingWindowSize: this.options.rollingWindowSize,
      },
    );
    const degradation = createDegradationSchema("local_latency_degraded", error);
    const notification = createFallbackUiNotification(degradation);
    const alert: MetricAlert = {
      type: "hybrid:metric_alert",
      severity: "warning",
      title: "Local route latency degraded",
      body: notification.body,
      degradation,
      notification,
      rollingWindow: [...this.localLatencyWindow],
      timestamp: new Date().toISOString(),
    };

    this.dispatchAlert(alert);
  }

  private dispatchAlert(alert: MetricAlert): void {
    captureTelemetryMessage(alert.title, "warning", {
      code: alert.degradation.mode,
      routeKind: REQUEST_DURATION_METRIC,
      metrics: {
        thresholdMs: this.options.latencyThresholdMs,
        windowSize: this.options.rollingWindowSize,
        latestDurationMs:
          alert.rollingWindow[alert.rollingWindow.length - 1]?.durationMs ?? 0,
      },
    });

    for (const listener of this.listeners) {
      Promise.resolve(listener(alert)).catch((error: unknown) => {
        captureTelemetryError(error, {
          code: "metric_alert_listener_failed",
          routeKind: REQUEST_DURATION_METRIC,
        });
      });
    }
  }

  private measureCpu(): SystemDiagnosticSnapshot["cpu"] {
    const now = performance.now();
    const current = process.cpuUsage();
    const elapsedMs = Math.max(1, now - this.lastCpuMeasuredAt);
    const cpuDeltaMicros =
      current.user -
      this.lastCpuUsage.user +
      current.system -
      this.lastCpuUsage.system;
    const logicalCores = Math.max(1, os.cpus().length);

    this.lastCpuUsage = current;
    this.lastCpuMeasuredAt = now;

    return {
      logicalCores,
      processCpuPercent: Math.min(
        100,
        (cpuDeltaMicros / (elapsedMs * 1_000 * logicalCores)) * 100,
      ),
      loadAverage1m: process.platform === "win32" ? undefined : os.loadavg()[0],
    };
  }
}

export const globalMetricsMonitor = new HybridMetricsMonitor({
  emitTelemetryHeartbeats: process.env.HYBRID_METRICS_HEARTBEATS === "1",
});

function percentile(values: number[], percentileRank: number): number {
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * percentileRank) - 1),
  );
  return values[index] ?? 0;
}

function errorCodeFromUnknown(error: unknown): string {
  if (error instanceof HybridModelError) {
    return error.code;
  }

  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }

  return "unknown_error";
}

function flattenDiagnosticSnapshot(
  snapshot: SystemDiagnosticSnapshot,
): Record<string, number | string | boolean | undefined> {
  return {
    generatedAt: snapshot.generatedAt,
    processCpuPercent: snapshot.cpu.processCpuPercent,
    loadAverage1m: snapshot.cpu.loadAverage1m,
    rssBytes: snapshot.memory.rssBytes,
    heapUsedBytes: snapshot.memory.heapUsedBytes,
    totalRequests: snapshot.requests.total,
    failedRequests: snapshot.requests.failed,
    avgLatencyMs: snapshot.requests.latency?.avgMs,
    p95LatencyMs: snapshot.requests.latency?.p95Ms,
    routingSwitchSuccess: snapshot.routingSwitches.success,
    routingSwitchFailed: snapshot.routingSwitches.failed,
  };
}

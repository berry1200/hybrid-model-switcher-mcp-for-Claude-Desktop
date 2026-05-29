import type { Event, SeverityLevel } from "@sentry/node";
export interface TelemetryConfig {
    dsn?: string;
    enabled?: boolean;
    environment?: string;
    release?: string;
    sampleRate?: number;
    tracesSampleRate?: number;
    serverName?: string;
}
export interface TelemetryCaptureContext {
    code?: string;
    routeKind?: string;
    provider?: string;
    model?: string;
    revision?: number;
    metrics?: Record<string, number | string | boolean | undefined>;
    tags?: Record<string, string | number | boolean | undefined>;
}
type JsonLike = null | string | number | boolean | JsonLike[] | {
    [key: string]: JsonLike;
};
export declare class TelemetryLogger {
    private readonly config;
    private initialized;
    constructor(config?: TelemetryConfig);
    init(): boolean;
    captureError(error: unknown, context?: TelemetryCaptureContext): void;
    captureMessage(message: string, level?: SeverityLevel, context?: TelemetryCaptureContext): void;
    flush(timeoutMs?: number): Promise<boolean>;
}
export declare function initializeTelemetryFromEnv(env?: NodeJS.ProcessEnv): TelemetryLogger;
export declare function getTelemetryLogger(): TelemetryLogger;
export declare function captureTelemetryError(error: unknown, context?: TelemetryCaptureContext): void;
export declare function captureTelemetryMessage(message: string, level?: SeverityLevel, context?: TelemetryCaptureContext): void;
export declare function loadTelemetryConfigFromEnv(env?: NodeJS.ProcessEnv): TelemetryConfig;
export declare function sanitizeTelemetryEvent(event: Event): Event | null;
export declare function sanitizeTelemetryPayload(value: unknown, depth?: number): JsonLike | undefined;
export declare function redactSensitiveText(value: string): string;
export {};

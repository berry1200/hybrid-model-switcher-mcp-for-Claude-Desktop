import type { SeverityLevel } from "@sentry/node";
export type CrashSeverity = "Fatal" | "Error" | "Warning";
export interface CrashClassification {
    severity: CrashSeverity;
    sentryLevel: SeverityLevel;
    fingerprint: string[];
    code: string;
    retryable: boolean;
    message: string;
    operationalRunbook: string;
}
export interface SourceMapReleasePlan {
    release: string;
    dist: string;
    artifactRoot: string;
    uploadCommand: string;
    rewriteCommand: string;
    privacyControls: string[];
    eventTags: Record<string, string>;
}
export declare const SENTRY_SOURCE_MAP_RUNBOOK: string;
export declare function classifyUnhandledException(error: unknown): CrashClassification;
export declare function captureClassifiedException(error: unknown, context: {
    routeKind: string;
    release?: string;
    dist?: string;
    platform?: string;
}): CrashClassification;
export declare function createSourceMapReleasePlan(input: {
    release: string;
    dist?: string;
    artifactRoot?: string;
}): SourceMapReleasePlan;
export declare function sanitizedCrashEnvelope(error: unknown): Record<string, unknown>;

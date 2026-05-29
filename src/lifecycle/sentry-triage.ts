import type { SeverityLevel } from "@sentry/node";
import {
  captureTelemetryError,
  captureTelemetryMessage,
  redactSensitiveText,
  sanitizeTelemetryPayload,
} from "../observability/telemetry.js";
import {
  ConfigurationError,
  HybridModelError,
  McpTimeoutError,
  PayloadTranslationError,
  RouterConnectionError,
  getErrorMessage,
} from "../utils/errors.js";

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

export const SENTRY_SOURCE_MAP_RUNBOOK = [
  "1. Build the production bundle with `npm.cmd run bundle` so `dist/production/hybrid-model-switcher-mcp.cjs.map` is generated.",
  "2. Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_RELEASE` in CI only.",
  "3. Run `sentry-cli sourcemaps inject dist/production` before upload so stack frames bind to the release.",
  "4. Run `sentry-cli sourcemaps upload dist/production --release $SENTRY_RELEASE --dist desktop` from the release workflow.",
  "5. Runtime events include only sanitized stack frames, internal error codes, release, dist, and route metadata; raw prompts and local source paths are redacted before send.",
  "6. Sentry resolves minified frames against uploaded maps server-side, giving maintainers exact generated-source locations without collecting user prompt payloads.",
].join("\n");

export function classifyUnhandledException(error: unknown): CrashClassification {
  const message = redactSensitiveText(getErrorMessage(error));

  if (isFatalRuntimeError(error)) {
    return {
      severity: "Fatal",
      sentryLevel: "fatal",
      fingerprint: ["fatal", errorName(error), errorCode(error)],
      code: errorCode(error),
      retryable: false,
      message,
      operationalRunbook:
        "Crash loop protection must run before reconnecting the proxy; restore host config if startup fails three times.",
    };
  }

  if (error instanceof RouterConnectionError || error instanceof McpTimeoutError) {
    return {
      severity: "Warning",
      sentryLevel: "warning",
      fingerprint: ["transient", error.code],
      code: error.code,
      retryable: true,
      message,
      operationalRunbook:
        "Keep the MCP connection alive, emit fallback signal, and retry through the configured local fallback route.",
    };
  }

  if (error instanceof PayloadTranslationError || error instanceof ConfigurationError) {
    return {
      severity: "Error",
      sentryLevel: "error",
      fingerprint: ["operator-action", error.code],
      code: error.code,
      retryable: false,
      message,
      operationalRunbook:
        "Return a host-readable error, avoid process termination, and require config or payload correction.",
    };
  }

  if (error instanceof HybridModelError) {
    return {
      severity: "Error",
      sentryLevel: "error",
      fingerprint: ["hybrid", error.code],
      code: error.code,
      retryable: false,
      message,
      operationalRunbook:
        "Capture the structured hybrid error and keep the MCP transport open when possible.",
    };
  }

  return {
    severity: "Error",
    sentryLevel: "error",
    fingerprint: ["unknown", errorName(error)],
    code: "unknown_error",
    retryable: false,
    message,
    operationalRunbook:
      "Capture sanitized exception metadata, keep user payloads local, and surface a safe fallback message.",
  };
}

export function captureClassifiedException(
  error: unknown,
  context: {
    routeKind: string;
    release?: string;
    dist?: string;
    platform?: string;
  },
): CrashClassification {
  const classification = classifyUnhandledException(error);
  captureTelemetryError(error, {
    code: classification.code,
    routeKind: context.routeKind,
    tags: {
      severity: classification.severity,
      release: context.release,
      dist: context.dist,
      platform: context.platform,
    },
  });

  captureTelemetryMessage("crash.triage.classified", classification.sentryLevel, {
    code: classification.code,
    routeKind: context.routeKind,
    tags: {
      severity: classification.severity,
    },
  });

  return classification;
}

export function createSourceMapReleasePlan(input: {
  release: string;
  dist?: string;
  artifactRoot?: string;
}): SourceMapReleasePlan {
  const dist = input.dist ?? "desktop";
  const artifactRoot = input.artifactRoot ?? "dist/production";

  return {
    release: input.release,
    dist,
    artifactRoot,
    rewriteCommand: `sentry-cli sourcemaps inject ${artifactRoot}`,
    uploadCommand:
      `sentry-cli sourcemaps upload ${artifactRoot} --release ${input.release} --dist ${dist}`,
    privacyControls: [
      "sendDefaultPii=false",
      "telemetry beforeSend redacts local paths",
      "prompt/tool payload keys are replaced with [REDACTED_INPUT]",
      "source maps are uploaded from CI artifacts, not user machines",
    ],
    eventTags: {
      release: input.release,
      dist,
      component: "hybrid-model-switcher-mcp",
    },
  };
}

export function sanitizedCrashEnvelope(error: unknown): Record<string, unknown> {
  const classification = classifyUnhandledException(error);
  return {
    classification,
    sanitized: sanitizeTelemetryPayload({
      name: errorName(error),
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  };
}

function isFatalRuntimeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const lower = `${error.name} ${error.message}`.toLowerCase();
  return (
    lower.includes("out of memory") ||
    lower.includes("heap limit") ||
    lower.includes("maximum call stack") ||
    lower.includes("eacces") ||
    lower.includes("uncaught exception") ||
    lower.includes("unhandled rejection")
  );
}

function errorCode(error: unknown): string {
  if (error instanceof HybridModelError) {
    return error.code;
  }

  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }

  return "unknown_error";
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

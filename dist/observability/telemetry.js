import * as Sentry from "@sentry/node";
import { HybridModelError, getErrorMessage } from "../utils/errors.js";
const REDACTED_SECRET = "[REDACTED_SECRET]";
const REDACTED_PATH = "[REDACTED_PATH]";
const REDACTED_INPUT = "[REDACTED_INPUT]";
const MAX_STRING_LENGTH = 1_000;
const MAX_SANITIZE_DEPTH = 8;
const API_KEY_PATTERNS = [
    /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,
    /\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
    /\b(?:anthropic|openai|litellm|api)[_-]?(?:api[_-]?)?key\s*[:=]\s*["']?[^"',\s]{8,}/gi,
];
const LOCAL_PATH_PATTERNS = [
    /\b[A-Za-z]:\\(?:[^<>:"/\\|?*\r\n]+\\)*[^<>:"/\\|?*\r\n]*/g,
    /\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9.$_-]+(?:\\[^<>:"/\\|?*\r\n]+)*/g,
    /(?<![A-Za-z0-9])\/(?:Users|home|var|tmp|private|mnt|Volumes|opt)\/[^\s"'`<>)]*/g,
];
const INPUT_PAYLOAD_KEYS = new Set([
    "args",
    "argument",
    "arguments",
    "body",
    "content",
    "input",
    "message",
    "messages",
    "params",
    "prompt",
    "raw",
    "request",
    "response",
    "system",
    "text",
    "tool_call",
    "tool_calls",
]);
const SECRET_KEYS = new Set([
    "apikey",
    "api_key",
    "authorization",
    "cookie",
    "dsn",
    "key",
    "password",
    "secret",
    "token",
]);
let activeTelemetry;
export class TelemetryLogger {
    config;
    initialized = false;
    constructor(config = loadTelemetryConfigFromEnv()) {
        this.config = config;
    }
    init() {
        if (this.initialized) {
            return true;
        }
        if (!isTelemetryEnabled(this.config)) {
            return false;
        }
        Sentry.init({
            dsn: this.config.dsn,
            environment: this.config.environment,
            release: this.config.release,
            sampleRate: this.config.sampleRate ?? 1,
            tracesSampleRate: this.config.tracesSampleRate ?? 0,
            serverName: this.config.serverName,
            sendDefaultPii: false,
            attachStacktrace: true,
            beforeSend: (event) => sanitizeTelemetryEvent(event),
        });
        this.initialized = true;
        return true;
    }
    captureError(error, context = {}) {
        if (!this.init()) {
            return;
        }
        const errorCode = context.code ?? errorCodeFromUnknown(error);
        const normalizedContext = sanitizeTelemetryPayload({
            ...context,
            code: errorCode,
        });
        Sentry.withScope((scope) => {
            scope.setTag("hybrid.code", errorCode);
            if (context.routeKind) {
                scope.setTag("hybrid.route_kind", context.routeKind);
            }
            if (context.provider) {
                scope.setTag("hybrid.provider", context.provider);
            }
            if (context.model) {
                scope.setTag("hybrid.model", redactSensitiveText(context.model));
            }
            scope.setContext("hybrid", normalizedContext);
            Sentry.captureException(error instanceof Error ? error : new Error(getErrorMessage(error)));
        });
    }
    captureMessage(message, level = "info", context = {}) {
        if (!this.init()) {
            return;
        }
        Sentry.withScope((scope) => {
            scope.setLevel(level);
            scope.setContext("hybrid", sanitizeTelemetryPayload(context));
            Sentry.captureMessage(redactSensitiveText(message), level);
        });
    }
    async flush(timeoutMs = 2_000) {
        if (!this.initialized) {
            return true;
        }
        return Sentry.flush(timeoutMs);
    }
}
export function initializeTelemetryFromEnv(env = process.env) {
    activeTelemetry = new TelemetryLogger(loadTelemetryConfigFromEnv(env));
    activeTelemetry.init();
    return activeTelemetry;
}
export function getTelemetryLogger() {
    activeTelemetry ??= new TelemetryLogger();
    return activeTelemetry;
}
export function captureTelemetryError(error, context = {}) {
    getTelemetryLogger().captureError(error, context);
}
export function captureTelemetryMessage(message, level = "info", context = {}) {
    getTelemetryLogger().captureMessage(message, level, context);
}
export function loadTelemetryConfigFromEnv(env = process.env) {
    return {
        dsn: normalizeEnvString(env.HYBRID_TELEMETRY_DSN ?? env.SENTRY_DSN),
        enabled: env.HYBRID_TELEMETRY_DISABLED !== "1",
        environment: normalizeEnvString(env.HYBRID_TELEMETRY_ENVIRONMENT ?? env.SENTRY_ENVIRONMENT ?? env.NODE_ENV),
        release: normalizeEnvString(env.HYBRID_RELEASE ?? env.SENTRY_RELEASE),
        sampleRate: parseRate(env.HYBRID_TELEMETRY_SAMPLE_RATE, 1),
        tracesSampleRate: parseRate(env.HYBRID_TELEMETRY_TRACES_SAMPLE_RATE, 0),
        serverName: normalizeEnvString(env.HYBRID_TELEMETRY_SERVER_NAME),
    };
}
export function sanitizeTelemetryEvent(event) {
    const sanitized = sanitizeTelemetryPayload(event);
    delete sanitized.user;
    delete sanitized.request;
    sanitized.extra = sanitizeTelemetryPayload(sanitized.extra);
    sanitized.contexts = sanitizeTelemetryPayload(sanitized.contexts);
    sanitized.tags = sanitizeTelemetryPayload(sanitized.tags);
    sanitized.message = sanitized.message
        ? truncate(redactSensitiveText(sanitized.message))
        : sanitized.message;
    sanitized.breadcrumbs = sanitized.breadcrumbs?.map((breadcrumb) => ({
        type: breadcrumb.type,
        category: breadcrumb.category,
        level: breadcrumb.level,
        timestamp: breadcrumb.timestamp,
        message: breadcrumb.message ? truncate(redactSensitiveText(breadcrumb.message)) : undefined,
        data: sanitizeTelemetryPayload(breadcrumb.data),
    }));
    if (sanitized.exception?.values) {
        sanitized.exception.values = sanitized.exception.values.map((exception) => ({
            type: exception.type ? redactSensitiveText(exception.type) : exception.type,
            value: exception.value ? truncate(redactSensitiveText(exception.value)) : exception.value,
            mechanism: exception.mechanism,
            stacktrace: exception.stacktrace
                ? {
                    frames: exception.stacktrace.frames?.map((frame) => ({
                        function: frame.function ? redactSensitiveText(frame.function) : frame.function,
                        filename: frame.filename ? redactSensitiveText(frame.filename) : frame.filename,
                        module: frame.module ? redactSensitiveText(frame.module) : frame.module,
                        lineno: frame.lineno,
                        colno: frame.colno,
                        in_app: frame.in_app,
                    })),
                }
                : undefined,
        }));
    }
    return sanitized;
}
export function sanitizeTelemetryPayload(value, depth = 0) {
    if (depth > MAX_SANITIZE_DEPTH) {
        return "[REDACTED_DEEP_OBJECT]";
    }
    if (value === undefined) {
        return undefined;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return truncate(redactSensitiveText(value));
    }
    if (Array.isArray(value)) {
        return value
            .slice(0, 50)
            .map((entry) => sanitizeTelemetryPayload(entry, depth + 1))
            .filter((entry) => entry !== undefined);
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (typeof value === "symbol") {
        return value.description ? `Symbol(${value.description})` : "Symbol()";
    }
    if (typeof value !== "object") {
        return `[${typeof value}]`;
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase();
        if (SECRET_KEYS.has(normalizedKey)) {
            output[key] = REDACTED_SECRET;
            continue;
        }
        if (INPUT_PAYLOAD_KEYS.has(normalizedKey)) {
            output[key] = REDACTED_INPUT;
            continue;
        }
        const sanitizedEntry = sanitizeTelemetryPayload(entry, depth + 1);
        if (sanitizedEntry !== undefined) {
            output[key] = sanitizedEntry;
        }
    }
    return output;
}
export function redactSensitiveText(value) {
    let redacted = value;
    for (const pattern of API_KEY_PATTERNS) {
        redacted = redacted.replace(pattern, REDACTED_SECRET);
    }
    for (const pattern of LOCAL_PATH_PATTERNS) {
        redacted = redacted.replace(pattern, REDACTED_PATH);
    }
    return redacted;
}
function isTelemetryEnabled(config) {
    return config.enabled !== false && Boolean(config.dsn?.trim());
}
function errorCodeFromUnknown(error) {
    if (error instanceof HybridModelError) {
        return error.code;
    }
    if (error && typeof error === "object" && "code" in error) {
        return String(error.code);
    }
    return "unknown_error";
}
function truncate(value) {
    return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
        : value;
}
function normalizeEnvString(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function parseRate(value, fallback) {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(1, Math.max(0, parsed));
}
//# sourceMappingURL=telemetry.js.map
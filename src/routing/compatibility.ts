import * as z from "zod/v4";
import type { AnthropicMessagesRequest } from "./litellm.js";
import type { ActiveLocalModelState } from "../tauri/config.js";
import { ConfigurationError, PayloadTranslationError } from "../utils/errors.js";

export const CURRENT_COMPATIBILITY_SCHEMA_VERSION = 2;

export interface HybridRuntimeConfigV2 {
  schemaVersion: 2;
  endpoints: {
    ollamaBaseUrl: string;
    liteLlmBaseUrl: string;
  };
  routing: {
    provider: "ollama" | "litellm" | "client";
    model?: string;
    litellmModel?: string;
    fallbackModel?: string;
    autoFallback: boolean;
  };
  updatedAt: string;
}

export interface NormalizedAnthropicRouteArgs {
  request: AnthropicMessagesRequest;
  modelOverride?: string;
  fallbackModelOverride?: string;
}

const providerSchema = z.enum(["ollama", "litellm", "client"]);

const runtimeConfigSchema = z
  .object({
    schemaVersion: z.literal(2),
    endpoints: z.object({
      ollamaBaseUrl: z.string().url(),
      liteLlmBaseUrl: z.string().url(),
    }),
    routing: z.object({
      provider: providerSchema,
      model: z.string().min(1).optional(),
      litellmModel: z.string().min(1).optional(),
      fallbackModel: z.string().min(1).optional(),
      autoFallback: z.boolean(),
    }),
    updatedAt: z.string().min(1),
  })
  .strict();

export function migrateRuntimeConfig(
  raw: unknown,
  defaults: {
    ollamaBaseUrl: string;
    liteLlmBaseUrl: string;
    defaultModel?: string;
  },
): HybridRuntimeConfigV2 {
  if (!raw || typeof raw !== "object") {
    return runtimeConfigFromLegacy({}, defaults);
  }

  const record = raw as Record<string, unknown>;
  if (record.schemaVersion === CURRENT_COMPATIBILITY_SCHEMA_VERSION) {
    const parsed = runtimeConfigSchema.safeParse(record);
    if (!parsed.success) {
      throw new ConfigurationError(
        "Current runtime config failed compatibility validation.",
        parsed.error.flatten(),
      );
    }

    return parsed.data;
  }

  return runtimeConfigFromLegacy(record, defaults);
}

export function migrateActiveModelState(raw: unknown): ActiveLocalModelState {
  if (!raw || typeof raw !== "object") {
    return createActiveModelState({});
  }

  return createActiveModelState(raw as Record<string, unknown>);
}

export function normalizeAnthropicRouteArgs(raw: unknown): NormalizedAnthropicRouteArgs {
  if (!raw || typeof raw !== "object") {
    throw new PayloadTranslationError("Tool arguments must be an object.");
  }

  const record = raw as Record<string, unknown>;
  const requestCandidate =
    record.request ?? record.payload ?? record.anthropic ?? record.messagesRequest;

  if (!requestCandidate || typeof requestCandidate !== "object") {
    throw new PayloadTranslationError(
      "Anthropic route arguments did not include a request payload.",
    );
  }

  const request = normalizeAnthropicMessagesRequest(
    requestCandidate as Record<string, unknown>,
  );

  return {
    request,
    modelOverride: normalizeOptionalString(
      record.modelOverride ?? record.model ?? record.localModel,
    ),
    fallbackModelOverride: normalizeOptionalString(
      record.fallbackModelOverride ?? record.fallbackModel ?? record.fallback,
    ),
  };
}

export function normalizeAnthropicMessagesRequest(
  raw: Record<string, unknown>,
): AnthropicMessagesRequest {
  const maxTokens = raw.max_tokens ?? raw.maxTokens;
  const stopSequences = raw.stop_sequences ?? raw.stopSequences ?? raw.stop;
  const topP = raw.top_p ?? raw.topP;

  return {
    ...raw,
    max_tokens:
      typeof maxTokens === "number"
        ? maxTokens
        : typeof maxTokens === "string"
          ? Number.parseInt(maxTokens, 10)
          : undefined,
    top_p: typeof topP === "number" ? topP : undefined,
    stop_sequences: Array.isArray(stopSequences)
      ? stopSequences.map(String)
      : typeof stopSequences === "string"
        ? [stopSequences]
        : undefined,
    stream: raw.stream === true || raw.stream === "true",
    messages: normalizeLegacyMessages(raw.messages),
    system: normalizeLegacySystem(raw.system ?? raw.systemPrompt),
  } as AnthropicMessagesRequest;
}

export function normalizeLiteLlmMetadata(
  metadata: unknown,
  routing: {
    provider: string;
    activeModel?: string;
    litellmModel?: string;
    revision?: number;
  },
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  return {
    ...base,
    "hybrid.provider": base["hybrid.provider"] ?? routing.provider,
    "hybrid.active_model": base["hybrid.active_model"] ?? routing.activeModel,
    "hybrid.litellm_model": base["hybrid.litellm_model"] ?? routing.litellmModel,
    "hybrid.revision": base["hybrid.revision"] ?? routing.revision ?? 0,
    "hybrid.compatibility_schema": CURRENT_COMPATIBILITY_SCHEMA_VERSION,
  };
}

function runtimeConfigFromLegacy(
  record: Record<string, unknown>,
  defaults: {
    ollamaBaseUrl: string;
    liteLlmBaseUrl: string;
    defaultModel?: string;
  },
): HybridRuntimeConfigV2 {
  const routingRecord = isPlainObject(record.routing) ? record.routing : record;
  const endpointsRecord = isPlainObject(record.endpoints) ? record.endpoints : record;
  const provider = normalizeProvider(routingRecord.provider);
  const model = normalizeOptionalString(routingRecord.model ?? defaults.defaultModel);
  const litellmModel = normalizeOptionalString(
    routingRecord.litellmModel ?? routingRecord.litellm_model ?? routingRecord.liteLlmModel,
  );

  return {
    schemaVersion: CURRENT_COMPATIBILITY_SCHEMA_VERSION,
    endpoints: {
      ollamaBaseUrl:
        normalizeOptionalString(endpointsRecord.ollamaBaseUrl ?? endpointsRecord.ollama_url) ??
        defaults.ollamaBaseUrl,
      liteLlmBaseUrl:
        normalizeOptionalString(
          endpointsRecord.liteLlmBaseUrl ??
            endpointsRecord.litellmBaseUrl ??
            endpointsRecord.litellm_url,
        ) ?? defaults.liteLlmBaseUrl,
    },
    routing: {
      provider,
      model,
      litellmModel,
      fallbackModel: normalizeOptionalString(
        routingRecord.fallbackModel ?? routingRecord.fallback_model,
      ),
      autoFallback:
        typeof routingRecord.autoFallback === "boolean"
          ? routingRecord.autoFallback
          : routingRecord.auto_fallback === false
            ? false
            : true,
    },
    updatedAt: normalizeOptionalString(record.updatedAt ?? record.updated_at) ?? new Date().toISOString(),
  };
}

function createActiveModelState(record: Record<string, unknown>): ActiveLocalModelState {
  return {
    provider: normalizeProvider(record.provider),
    model: normalizeOptionalString(record.model),
    litellmModel: normalizeOptionalString(
      record.litellmModel ?? record.litellm_model ?? record.liteLlmModel,
    ),
    fallbackModel: normalizeOptionalString(record.fallbackModel ?? record.fallback_model),
    autoFallback:
      typeof record.autoFallback === "boolean"
        ? record.autoFallback
        : record.auto_fallback === false
          ? false
          : true,
    revision:
      typeof record.revision === "number" && Number.isInteger(record.revision)
        ? Math.max(0, record.revision)
        : 0,
    updatedAt:
      normalizeOptionalString(record.updatedAt ?? record.updated_at) ??
      new Date().toISOString(),
  };
}

function normalizeProvider(value: unknown): "ollama" | "litellm" | "client" {
  if (value === "ollama" || value === "client" || value === "litellm") {
    return value;
  }

  if (value === "local" || value === "lite_llm" || value === "liteLlm") {
    return "litellm";
  }

  return "litellm";
}

function normalizeLegacyMessages(value: unknown): AnthropicMessagesRequest["messages"] {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return {
          role: "user" as const,
          content: String(entry),
        };
      }

      const record = entry as Record<string, unknown>;
      return {
        role: record.role === "assistant" ? "assistant" : "user",
        content:
          typeof record.content === "string"
            ? record.content
            : typeof record.text === "string"
              ? record.text
              : JSON.stringify(record.content ?? ""),
      };
    });
  }

  if (typeof value === "string") {
    return [{ role: "user", content: value }];
  }

  throw new PayloadTranslationError("Anthropic request messages are missing or invalid.");
}

function normalizeLegacySystem(value: unknown): AnthropicMessagesRequest["system"] {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

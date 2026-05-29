import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { PayloadTranslationError } from "../utils/errors.js";

const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_LENGTH = 128_000;

const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "command",
  "cmd",
  "shell",
  "exec",
  "spawn",
  "powershell",
  "bash",
  "zsh",
  "sh",
]);

const providerSchema = z.enum(["ollama", "client", "litellm"]);
const phaseOneProviderSchema = z.enum(["ollama", "client"]);

const generationOptionsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().positive().optional(),
    num_ctx: z.number().int().positive().optional(),
    num_predict: z.number().int().positive().optional(),
    stop: z.array(z.string()).max(32).optional(),
  })
  .strict()
  .optional();

const chatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(MAX_STRING_LENGTH),
  })
  .strict();

const anthropicTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(MAX_STRING_LENGTH),
  })
  .strict();

const anthropicImageBlockSchema = z
  .object({
    type: z.literal("image"),
    source: z.union([
      z
        .object({
          type: z.literal("base64"),
          media_type: z.string().min(1).max(128),
          data: z.string().min(1).max(MAX_STRING_LENGTH),
        })
        .strict(),
      z
        .object({
          type: z.literal("url"),
          url: z.string().url().max(4096),
        })
        .strict(),
    ]),
  })
  .strict();

const anthropicContentBlockSchema = z.union([
  anthropicTextBlockSchema,
  anthropicImageBlockSchema,
]);

const anthropicMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.union([
      z.string().max(MAX_STRING_LENGTH),
      z.array(anthropicContentBlockSchema).min(1).max(MAX_ARRAY_ITEMS),
    ]),
  })
  .strict();

const metadataSchema = z.record(
  z.string().min(1).max(128),
  z.union([
    z.string().max(4096),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.string().max(4096)).max(64),
  ]),
);

const toolArgumentSchemas = {
  hybrid_status: z.object({}).strict(),
  hybrid_list_models: z.object({}).strict(),
  hybrid_set_model: z
    .object({
      provider: providerSchema.optional(),
      model: z.string().min(1).max(256).optional(),
      litellmModel: z.string().min(1).max(256).optional(),
      fallbackModel: z.string().min(1).max(256).optional(),
      autoFallback: z.boolean().optional(),
    })
    .strict(),
  hybrid_generate: z
    .object({
      prompt: z.string().min(1).max(MAX_STRING_LENGTH),
      system: z.string().max(MAX_STRING_LENGTH).optional(),
      provider: phaseOneProviderSchema.optional(),
      model: z.string().min(1).max(256).optional(),
      options: generationOptionsSchema,
    })
    .strict(),
  hybrid_chat: z
    .object({
      messages: z.array(chatMessageSchema).min(1).max(MAX_ARRAY_ITEMS),
      provider: phaseOneProviderSchema.optional(),
      model: z.string().min(1).max(256).optional(),
      options: generationOptionsSchema,
    })
    .strict(),
  hybrid_route_anthropic: z
    .object({
      request: z
        .object({
          model: z.string().min(1).max(256).optional(),
          max_tokens: z.number().int().positive().max(1_000_000).optional(),
          messages: z.array(anthropicMessageSchema).min(1).max(MAX_ARRAY_ITEMS),
          system: z
            .union([
              z.string().max(MAX_STRING_LENGTH),
              z.array(anthropicTextBlockSchema).min(1).max(MAX_ARRAY_ITEMS),
            ])
            .optional(),
          temperature: z.number().min(0).max(2).optional(),
          top_p: z.number().min(0).max(1).optional(),
          stop_sequences: z.array(z.string().max(1024)).max(32).optional(),
          stream: z.boolean().optional(),
          metadata: metadataSchema.optional(),
        })
        .strict(),
      modelOverride: z.string().min(1).max(256).optional(),
      fallbackModelOverride: z.string().min(1).max(256).optional(),
    })
    .strict(),
  hybrid_recommend_model: z
    .object({
      taskType: z.string().min(1).max(64),
    })
    .strict(),
} satisfies Record<string, z.ZodType>;

type SupportedToolName = keyof typeof toolArgumentSchemas;

export function sanitizeToolCallRequest(request: CallToolRequest): CallToolRequest {
  const toolName = request.params.name;

  if (!isSupportedToolName(toolName)) {
    throw new PayloadTranslationError(`Unsupported tool call: ${toolName}`, {
      toolName,
    });
  }

  const rawArguments = request.params.arguments ?? {};
  assertJsonSafe(rawArguments, "$");

  const schema = toolArgumentSchemas[toolName];
  const parsed = schema.safeParse(rawArguments);
  if (!parsed.success) {
    throw new PayloadTranslationError(
      "Tool payload failed strict sanitation.",
      parsed.error.flatten(),
    );
  }

  return {
    ...request,
    params: {
      ...request.params,
      arguments: deepFreeze(deepClone(parsed.data)) as Record<string, unknown>,
    },
  };
}

export function assertJsonSafe(value: unknown, path: string, depth = 0): void {
  if (depth > MAX_DEPTH) {
    throw new PayloadTranslationError("Tool payload exceeds maximum nesting depth.", {
      path,
      maxDepth: MAX_DEPTH,
    });
  }

  if (value === null) {
    return;
  }

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new PayloadTranslationError("Tool payload string exceeds maximum length.", {
        path,
        maxStringLength: MAX_STRING_LENGTH,
      });
    }

    if (/[\u0000\u001b]/u.test(value)) {
      throw new PayloadTranslationError(
        "Tool payload contains forbidden control characters.",
        { path },
      );
    }
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PayloadTranslationError("Tool payload contains a non-finite number.", {
        path,
      });
    }
    return;
  }

  if (typeof value === "boolean") {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new PayloadTranslationError("Tool payload array exceeds item limit.", {
        path,
        maxArrayItems: MAX_ARRAY_ITEMS,
      });
    }

    value.forEach((item, index) => {
      assertJsonSafe(item, `${path}[${index}]`, depth + 1);
    });
    return;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PayloadTranslationError(
        "Tool payload contains a non-plain object.",
        { path },
      );
    }

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new PayloadTranslationError(
          "Tool payload contains a forbidden key associated with shell execution or prototype pollution.",
          { path: `${path}.${key}`, key },
        );
      }

      assertJsonSafe(item, `${path}.${key}`, depth + 1);
    }
    return;
  }

  throw new PayloadTranslationError("Tool payload contains a non-JSON value.", {
    path,
    type: typeof value,
  });
}

function isSupportedToolName(name: string): name is SupportedToolName {
  return name in toolArgumentSchemas;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);

  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }

  return value;
}


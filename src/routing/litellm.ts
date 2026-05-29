import * as z from "zod/v4";
import type { ActiveLocalModelState } from "../tauri/config.js";
import {
  McpTimeoutError,
  PayloadTranslationError,
  RouterConnectionError,
  getErrorMessage,
  parseLocalLlmFailure,
} from "../utils/errors.js";

const DEFAULT_LITELLM_BASE_URL = "http://127.0.0.1:4000";
const DEFAULT_LITELLM_TIMEOUT_MS = 120_000;
const DEFAULT_LOCAL_MODEL_PREFIX = "ollama_chat";

const anthropicTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .catchall(z.unknown());

const anthropicImageBlockSchema = z
  .object({
    type: z.literal("image"),
    source: z.union([
      z
        .object({
          type: z.literal("base64"),
          media_type: z.string().min(1),
          data: z.string().min(1),
        })
        .catchall(z.unknown()),
      z
        .object({
          type: z.literal("url"),
          url: z.string().url(),
        })
        .catchall(z.unknown()),
    ]),
  })
  .catchall(z.unknown());

const anthropicContentBlockSchema = z.union([
  anthropicTextBlockSchema,
  anthropicImageBlockSchema,
]);

const anthropicMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.union([
      z.string(),
      z.array(anthropicContentBlockSchema).min(1),
    ]),
  })
  .catchall(z.unknown());

export const anthropicMessagesRequestSchema = z
  .object({
    model: z.string().min(1).optional(),
    max_tokens: z.number().int().positive().optional(),
    messages: z.array(anthropicMessageSchema).min(1),
    system: z
      .union([z.string(), z.array(anthropicTextBlockSchema).min(1)])
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tools: z.array(z.unknown()).optional(),
    tool_choice: z.unknown().optional(),
  })
  .catchall(z.unknown());

export type AnthropicMessagesRequest = z.infer<
  typeof anthropicMessagesRequestSchema
>;

export interface LiteLlmRouterConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  localModelPrefix?: string;
}

export interface ActiveModelSnapshotProvider {
  getRequiredSnapshot(): Promise<Readonly<ActiveLocalModelState>>;
}

export interface LiteLlmDispatchOptions {
  modelOverride?: string;
  fallbackModelOverride?: string;
}

export interface LiteLlmDispatchResult {
  provider: "litellm";
  model: string;
  activeModel: string;
  revision: number;
  text: string;
  raw: unknown;
  fallbackUsed: boolean;
}

export interface McpLifecycleForwardResult {
  ok: boolean;
  status?: number;
}

interface OpenAiTextContent {
  type: "text";
  text: string;
}

interface OpenAiImageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
}

type OpenAiMessageContent = string | Array<OpenAiTextContent | OpenAiImageContent>;

interface OpenAiChatMessage {
  role: "system" | "user" | "assistant";
  content: OpenAiMessageContent;
}

interface LiteLlmChatPayload {
  model: string;
  messages: OpenAiChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: false;
  metadata: Record<string, unknown>;
}

export interface OllamaChatPayload {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
    images?: string[];
  }>;
  stream: false;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    stop?: string[];
  };
}

interface LiteLlmErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
  detail?: unknown;
  message?: string;
}

export class LiteLlmRouter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly localModelPrefix: string;

  constructor(
    private readonly activeModelState: ActiveModelSnapshotProvider,
    private readonly config: LiteLlmRouterConfig = {},
  ) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_LITELLM_BASE_URL);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_LITELLM_TIMEOUT_MS;
    this.localModelPrefix =
      config.localModelPrefix ?? DEFAULT_LOCAL_MODEL_PREFIX;
  }

  async dispatchAnthropic(
    request: AnthropicMessagesRequest,
    options: LiteLlmDispatchOptions = {},
  ): Promise<LiteLlmDispatchResult> {
    const parsedRequest = this.parseRequest(request);
    const snapshot = await this.activeModelState.getRequiredSnapshot();

    try {
      const primary = translateAnthropicToLiteLlm(
        parsedRequest,
        snapshot,
        this.resolveModel(snapshot, options.modelOverride),
      );

      return await this.dispatchTranslatedPayload(primary, snapshot, false);
    } catch (error) {
      const normalized = parseLocalLlmFailure(error);
      if (normalized instanceof PayloadTranslationError) {
        throw normalized;
      }

      const fallbackModel =
        options.fallbackModelOverride ?? snapshot.fallbackModel;

      if (!snapshot.autoFallback || !fallbackModel) {
        throw normalized;
      }

      const fallbackPayload = translateAnthropicToLiteLlm(
        parsedRequest,
        snapshot,
        this.resolveModel(snapshot, fallbackModel),
      );

      return this.dispatchTranslatedPayload(fallbackPayload, snapshot, true);
    }
  }

  async dispatchTranslatedPayload(
    payload: LiteLlmChatPayload,
    snapshot: Readonly<ActiveLocalModelState>,
    fallbackUsed: boolean,
  ): Promise<LiteLlmDispatchResult> {
    const response = await this.fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: this.headers(snapshot, "anthropic-message"),
      body: JSON.stringify(payload),
    });

    return {
      provider: "litellm",
      model: payload.model,
      activeModel: snapshot.model ?? payload.model,
      revision: snapshot.revision,
      text: extractAssistantText(response),
      raw: response,
      fallbackUsed,
    };
  }

  async forwardMcpLifecycleEvent(
    method: "tools/list" | "tools/call",
    request: { method: string; params?: unknown },
  ): Promise<McpLifecycleForwardResult> {
    const snapshot = await this.activeModelState.getRequiredSnapshot();
    const payload = {
      method,
      params: request.params ?? {},
      routing: {
        provider: snapshot.provider,
        activeModel: snapshot.model,
        litellmModel: snapshot.litellmModel,
        revision: snapshot.revision,
      },
    };

    const response = await this.fetchRaw("/hybrid/mcp/lifecycle", {
      method: "POST",
      headers: this.headers(snapshot, method),
      body: JSON.stringify(payload),
    });

    return {
      ok: response.ok,
      status: response.status,
    };
  }

  private parseRequest(request: AnthropicMessagesRequest): AnthropicMessagesRequest {
    const parsed = anthropicMessagesRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new PayloadTranslationError(
        "Anthropic request payload failed validation.",
        parsed.error.flatten(),
      );
    }

    return parsed.data;
  }

  private resolveModel(
    snapshot: Readonly<ActiveLocalModelState>,
    override?: string,
  ): string {
    const candidate =
      override?.trim() || snapshot.litellmModel || snapshot.model || undefined;

    if (!candidate) {
      throw new PayloadTranslationError(
        "No active local model is available for LiteLLM routing.",
        { snapshot },
      );
    }

    if (candidate.includes("/")) {
      return candidate;
    }

    return `${this.localModelPrefix}/${candidate}`;
  }

  private async fetchJson(endpoint: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchRaw(endpoint, init);
    return await response.json();
  }

  private async fetchRaw(endpoint: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await parseLiteLlmHttpError(response);
      }

      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new McpTimeoutError("LiteLLM request timed out.", {
          timeoutMs: this.timeoutMs,
          baseUrl: this.baseUrl,
        });
      }

      const message = getErrorMessage(error);
      if (
        message.toLowerCase().includes("fetch failed") ||
        message.toLowerCase().includes("econnrefused")
      ) {
        throw new RouterConnectionError(
          `Could not reach LiteLLM gateway at ${this.baseUrl}.`,
          { cause: message },
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(
    snapshot: Readonly<ActiveLocalModelState>,
    routeKind: string,
  ): HeadersInit {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-hybrid-route-kind": routeKind,
      "x-hybrid-provider": snapshot.provider,
      "x-hybrid-active-model": snapshot.model ?? "",
      "x-hybrid-litellm-model": snapshot.litellmModel ?? "",
      "x-hybrid-state-revision": String(snapshot.revision),
    };

    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }
}

export function translateAnthropicToLiteLlm(
  request: AnthropicMessagesRequest,
  snapshot: Readonly<ActiveLocalModelState>,
  model: string,
): LiteLlmChatPayload {
  if (request.stream) {
    throw new PayloadTranslationError(
      "Streaming Anthropic requests are not routed through tools/call in this MVP.",
    );
  }

  if (request.tools?.length || request.tool_choice !== undefined) {
    throw new PayloadTranslationError(
      "Anthropic tool-use payloads cannot be safely translated to a local LiteLLM chat request yet.",
      {
        toolsProvided: request.tools?.length ?? 0,
        hasToolChoice: request.tool_choice !== undefined,
      },
    );
  }

  const messages: OpenAiChatMessage[] = [];

  if (request.system) {
    messages.push({
      role: "system",
      content: translateSystemContent(request.system),
    });
  }

  for (const message of request.messages) {
    messages.push({
      role: message.role,
      content: translateMessageContent(message.content),
    });
  }

  return {
    model,
    messages,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    top_p: request.top_p,
    stop: request.stop_sequences,
    stream: false,
    metadata: {
      ...(request.metadata ?? {}),
      "hybrid.provider": snapshot.provider,
      "hybrid.active_model": snapshot.model,
      "hybrid.litellm_model": model,
      "hybrid.revision": snapshot.revision,
      "hybrid.updated_at": snapshot.updatedAt,
    },
  };
}

export function translateAnthropicToOllamaChat(
  request: AnthropicMessagesRequest,
  model: string,
): OllamaChatPayload {
  if (request.stream) {
    throw new PayloadTranslationError(
      "Streaming Anthropic requests must use the guarded streaming route, not buffered Ollama chat translation.",
    );
  }

  if (request.tools?.length || request.tool_choice !== undefined) {
    throw new PayloadTranslationError(
      "Anthropic tool-use payloads cannot be safely translated to Ollama chat.",
      {
        toolsProvided: request.tools?.length ?? 0,
        hasToolChoice: request.tool_choice !== undefined,
      },
    );
  }

  const messages: OllamaChatPayload["messages"] = [];

  if (request.system) {
    messages.push({
      role: "system",
      content: translateSystemContent(request.system),
    });
  }

  for (const message of request.messages) {
    messages.push({
      role: message.role,
      ...translateOllamaMessageContent(message.content),
    });
  }

  return {
    model,
    messages,
    stream: false,
    options: {
      temperature: request.temperature,
      top_p: request.top_p,
      num_predict: request.max_tokens,
      stop: request.stop_sequences,
    },
  };
}

async function parseLiteLlmHttpError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  const parsed = parseErrorBody(body);
  const message = parsed.message || `${response.status} ${response.statusText}`;
  const lower = message.toLowerCase();

  if (response.status === 408 || response.status === 504) {
    return new McpTimeoutError("LiteLLM gateway timed out.", {
      status: response.status,
      body: parsed.raw,
    });
  }

  if (
    lower.includes("context length") ||
    lower.includes("maximum context") ||
    lower.includes("too many tokens") ||
    lower.includes("prompt too long")
  ) {
    return new PayloadTranslationError(
      "The selected local model cannot fit this request in context.",
      { status: response.status, body: parsed.raw },
    );
  }

  if (response.status >= 500 || response.status === 429) {
    return new RouterConnectionError("LiteLLM gateway returned an upstream error.", {
      status: response.status,
      body: parsed.raw,
      message,
    });
  }

  return new PayloadTranslationError("LiteLLM rejected the translated payload.", {
    status: response.status,
    body: parsed.raw,
    message,
  });
}

function parseErrorBody(body: string): { message?: string; raw: string } {
  if (!body) {
    return { raw: "" };
  }

  try {
    const parsed = JSON.parse(body) as LiteLlmErrorPayload;
    const detail =
      typeof parsed.detail === "string"
        ? parsed.detail
        : parsed.detail
          ? JSON.stringify(parsed.detail)
          : undefined;

    return {
      message: parsed.error?.message ?? parsed.message ?? detail,
      raw: body,
    };
  } catch {
    return { message: body, raw: body };
  }
}

function translateSystemContent(
  system: NonNullable<AnthropicMessagesRequest["system"]>,
): string {
  if (typeof system === "string") {
    return system;
  }

  return system.map((block) => block.text).join("\n\n");
}

function translateMessageContent(
  content: AnthropicMessagesRequest["messages"][number]["content"],
): OpenAiMessageContent {
  if (typeof content === "string") {
    return content;
  }

  const translated = content.map((block) => {
    if (block.type === "text") {
      return {
        type: "text" as const,
        text: block.text,
      };
    }

    if (block.source.type === "url") {
      return {
        type: "image_url" as const,
        image_url: {
          url: block.source.url,
        },
      };
    }

    return {
      type: "image_url" as const,
      image_url: {
        url: `data:${block.source.media_type};base64,${block.source.data}`,
      },
    };
  });

  const allText = translated.every((block) => block.type === "text");
  if (allText) {
    return translated.map((block) => ("text" in block ? block.text : "")).join("");
  }

  return translated;
}

function translateOllamaMessageContent(
  content: AnthropicMessagesRequest["messages"][number]["content"],
): { content: string; images?: string[] } {
  if (typeof content === "string") {
    return { content };
  }

  const text: string[] = [];
  const images: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      text.push(block.text);
      continue;
    }

    if (block.source.type !== "base64") {
      throw new PayloadTranslationError(
        "Ollama chat translation only supports base64 image content blocks.",
      );
    }

    images.push(block.source.data);
  }

  return {
    content: text.join(""),
    images: images.length > 0 ? images : undefined,
  };
}

function extractAssistantText(response: unknown): string {
  if (!response || typeof response !== "object") {
    throw new RouterConnectionError("LiteLLM returned an empty response.", {
      response,
    });
  }

  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new RouterConnectionError(
      "LiteLLM response did not contain any assistant choices.",
      { response },
    );
  }

  const firstChoice = choices[0] as {
    message?: { content?: unknown };
    text?: unknown;
  };

  const content = firstChoice.message?.content ?? firstChoice.text;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String((item as { text: unknown }).text)
          : "",
      )
      .join("");
  }

  throw new RouterConnectionError(
    "LiteLLM assistant choice did not include text content.",
    { response },
  );
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

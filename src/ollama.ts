import { HybridModelError, getErrorMessage } from "./errors.js";
import type {
  AppConfig,
  ChatMessage,
  GenerationOptions,
  OllamaModel,
} from "./types.js";

interface OllamaModelDetails {
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    modified_at?: string;
    size?: number;
    digest?: string;
    details?: OllamaModelDetails;
  }>;
}

interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaStreamGenerateChunk {
  response?: string;
  done?: boolean;
  error?: string;
}

export class OllamaConnector {
  constructor(
    private readonly config: Pick<
      AppConfig,
      "ollamaBaseUrl" | "requestTimeoutMs"
    >,
  ) {}

  async health(): Promise<{ ok: boolean; baseUrl: string; error?: string }> {
    try {
      await this.listModels();
      return { ok: true, baseUrl: this.config.ollamaBaseUrl };
    } catch (error) {
      return {
        ok: false,
        baseUrl: this.config.ollamaBaseUrl,
        error: getErrorMessage(error),
      };
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const data = await this.request<OllamaTagsResponse>("/api/tags");
    return (data.models ?? [])
      .map((model) => normalizeModel(model))
      .filter((model): model is OllamaModel => Boolean(model));
  }

  async generate(input: {
    model: string;
    prompt: string;
    system?: string;
    options?: GenerationOptions;
  }): Promise<{ text: string; model?: string; raw: OllamaGenerateResponse }> {
    const response = await this.request<OllamaGenerateResponse>("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        system: input.system,
        stream: false,
        options: compactOptions(input.options),
      }),
    });

    return {
      text: response.response ?? "",
      model: response.model ?? input.model,
      raw: response,
    };
  }

  async chat(input: {
    model: string;
    messages: ChatMessage[];
    options?: GenerationOptions;
  }): Promise<{ text: string; model?: string; raw: OllamaChatResponse }> {
    const response = await this.request<OllamaChatResponse>("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        stream: false,
        options: compactOptions(input.options),
      }),
    });

    return {
      text: response.message?.content ?? "",
      model: response.model ?? input.model,
      raw: response,
    };
  }

  async *streamGenerate(input: {
    model: string;
    prompt: string;
    system?: string;
    options?: GenerationOptions;
  }): AsyncGenerator<string> {
    const response = await this.fetchWithTimeout("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        system: input.system,
        stream: true,
        options: compactOptions(input.options),
      }),
    });

    if (!response.body) {
      throw new HybridModelError("ollama_stream_failed", "Ollama returned no stream body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          const chunk = JSON.parse(line) as OllamaStreamGenerateChunk;
          if (chunk.error) {
            throw new HybridModelError("ollama_stream_error", chunk.error);
          }
          if (chunk.response) {
            yield chunk.response;
          }
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }
  }

  private async request<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchWithTimeout(endpoint, init);
    return (await response.json()) as T;
  }

  private async fetchWithTimeout(endpoint: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(`${this.config.ollamaBaseUrl}${endpoint}`, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new HybridModelError(
          "ollama_request_failed",
          `Ollama request failed with ${response.status} ${response.statusText}`,
          body,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof HybridModelError) {
        throw error;
      }

      throw new HybridModelError(
        "ollama_unavailable",
        `Could not reach Ollama at ${this.config.ollamaBaseUrl}`,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeModel(model: NonNullable<OllamaTagsResponse["models"]>[number]):
  | OllamaModel
  | undefined {
  const name = model.name ?? model.model;
  if (!name) {
    return undefined;
  }

  return {
    name,
    modifiedAt: model.modified_at,
    size: model.size,
    digest: model.digest,
    family: model.details?.family,
    families: model.details?.families,
    parameterSize: model.details?.parameter_size,
    quantizationLevel: model.details?.quantization_level,
  };
}

function compactOptions(
  options: GenerationOptions | undefined,
): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  const entries = Object.entries(options).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}


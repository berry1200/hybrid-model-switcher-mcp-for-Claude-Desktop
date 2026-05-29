import { HybridModelError, getErrorMessage } from "./errors.js";
import { MODEL_RECOMMENDATIONS } from "./recommendations.js";
import type { ModelStateManager } from "./state.js";
import type {
  AppConfig,
  ChatRequest,
  GenerationRequest,
  GenerationResult,
  OllamaModel,
  Provider,
} from "./types.js";
import type { OllamaConnector } from "./ollama.js";

type ClientSampler = (input: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  options?: GenerationRequest["options"];
}) => Promise<GenerationResult>;

export class HybridRouter {
  constructor(
    private readonly deps: {
      config: AppConfig;
      ollama: OllamaConnector;
      state: ModelStateManager;
    },
  ) {}

  async status(): Promise<Record<string, unknown>> {
    const [state, health] = await Promise.all([
      this.deps.state.get(),
      this.deps.ollama.health(),
    ]);

    let models: OllamaModel[] = [];
    if (health.ok) {
      models = await this.deps.ollama.listModels();
    }

    return {
      state,
      ollama: {
        ...health,
        modelCount: models.length,
      },
      config: {
        ollamaBaseUrl: this.deps.config.ollamaBaseUrl,
        statePath: this.deps.config.statePath,
        requestTimeoutMs: this.deps.config.requestTimeoutMs,
        defaultModel: this.deps.config.defaultModel,
      },
      boundary:
        "MCP tools can route explicit requests, but cannot replace Claude Desktop core inference.",
    };
  }

  async listModels(): Promise<Record<string, unknown>> {
    const [state, localModels] = await Promise.all([
      this.deps.state.get(),
      this.deps.ollama.listModels(),
    ]);

    return {
      active: state,
      providers: [
        {
          id: "ollama",
          label: "Ollama local models",
          available: true,
        },
        {
          id: "client",
          label: "Connected MCP client via sampling",
          available:
            "depends on whether the MCP client advertises sampling support",
        },
      ],
      localModels,
      recommendations: MODEL_RECOMMENDATIONS,
    };
  }

  async setModel(input: {
    provider?: Provider;
    model?: string;
    autoFallback?: boolean;
  }): Promise<Record<string, unknown>> {
    const provider = input.provider ?? (await this.deps.state.get()).provider;

    if (provider === "ollama" && input.model) {
      await this.assertOllamaModelExists(input.model);
    }

    const state = await this.deps.state.set({
      provider,
      model: input.model,
      autoFallback: input.autoFallback,
    });

    return {
      active: state,
      note:
        "This changes the MCP router state. Claude Desktop's native model selector is unchanged.",
    };
  }

  async generate(
    input: GenerationRequest,
    clientSampler: ClientSampler,
  ): Promise<GenerationResult> {
    const selected = await this.resolveSelection(input.provider, input.model);

    if (selected.provider === "client") {
      return this.tryClientThenFallback(
        clientSampler,
        {
          messages: [
            ...(input.system
              ? [{ role: "system" as const, content: input.system }]
              : []),
            { role: "user" as const, content: input.prompt },
          ],
          model: selected.model,
          options: input.options,
        },
        input.model,
      );
    }

    return this.generateWithOllama({
      model: await this.resolveOllamaModel(selected.model),
      prompt: input.prompt,
      system: input.system,
      options: input.options,
    });
  }

  async chat(input: ChatRequest, clientSampler: ClientSampler): Promise<GenerationResult> {
    const selected = await this.resolveSelection(input.provider, input.model);

    if (selected.provider === "client") {
      return this.tryClientThenFallback(
        clientSampler,
        {
          messages: input.messages,
          model: selected.model,
          options: input.options,
        },
        input.model,
      );
    }

    const model = await this.resolveOllamaModel(selected.model);
    const startedAt = Date.now();
    const response = await this.deps.ollama.chat({
      model,
      messages: input.messages,
      options: input.options,
    });

    return {
      provider: "ollama",
      model: response.model ?? model,
      text: response.text,
      elapsedMs: Date.now() - startedAt,
      raw: response.raw,
    };
  }

  private async tryClientThenFallback(
    clientSampler: ClientSampler,
    input: Parameters<ClientSampler>[0],
    explicitModel?: string,
  ): Promise<GenerationResult> {
    try {
      return await clientSampler(input);
    } catch (error) {
      const state = await this.deps.state.get();
      if (!state.autoFallback) {
        throw error;
      }

      const fallbackModel = await this.resolveOllamaModel(
        explicitModel ?? this.deps.config.defaultModel ?? state.model,
      );
      const prompt = input.messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n");

      const result = await this.generateWithOllama({
        model: fallbackModel,
        prompt,
        options: input.options,
      });

      return {
        ...result,
        fallbackUsed: true,
        warning: `Client sampling failed, so autoFallback used Ollama. Cause: ${getErrorMessage(error)}`,
      };
    }
  }

  private async generateWithOllama(input: {
    model: string;
    prompt: string;
    system?: string;
    options?: GenerationRequest["options"];
  }): Promise<GenerationResult> {
    const startedAt = Date.now();
    const response = await this.deps.ollama.generate(input);

    return {
      provider: "ollama",
      model: response.model ?? input.model,
      text: response.text,
      elapsedMs: Date.now() - startedAt,
      raw: response.raw,
    };
  }

  private async resolveSelection(
    provider?: Provider,
    model?: string,
  ): Promise<{ provider: Provider; model?: string }> {
    const state = await this.deps.state.get();
    return {
      provider: provider ?? state.provider,
      model: model ?? state.model ?? this.deps.config.defaultModel,
    };
  }

  private async resolveOllamaModel(model?: string): Promise<string> {
    if (model) {
      return model;
    }

    const models = await this.deps.ollama.listModels();
    const firstModel = models[0]?.name;
    if (firstModel) {
      return firstModel;
    }

    throw new HybridModelError(
      "ollama_model_missing",
      "No Ollama model is selected or installed. Run ollama pull deepseek-r1, then call hybrid_set_model.",
    );
  }

  private async assertOllamaModelExists(modelName: string): Promise<void> {
    const models = await this.deps.ollama.listModels();
    const found = models.some((model) => model.name === modelName);

    if (!found) {
      throw new HybridModelError(
        "ollama_model_not_found",
        `Ollama model "${modelName}" is not installed. Use hybrid_list_models or run ollama pull first.`,
        { installedModels: models.map((model) => model.name) },
      );
    }
  }
}


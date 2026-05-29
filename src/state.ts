import fs from "node:fs/promises";
import path from "node:path";
import { HybridModelError } from "./errors.js";
import type { AppConfig, HybridState, Provider } from "./types.js";

export class ModelStateManager {
  private cachedState: HybridState | undefined;

  constructor(private readonly config: Pick<AppConfig, "statePath" | "defaultModel">) {}

  async get(): Promise<HybridState> {
    if (this.cachedState) {
      return this.cachedState;
    }

    try {
      const raw = await fs.readFile(this.config.statePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.cachedState = validateState(parsed);
      return this.cachedState;
    } catch (error) {
      if (isMissingFileError(error)) {
        this.cachedState = createDefaultState(this.config.defaultModel);
        return this.cachedState;
      }

      throw new HybridModelError(
        "state_read_failed",
        `Could not read model state at ${this.config.statePath}`,
        error,
      );
    }
  }

  async set(update: {
    provider?: Provider;
    model?: string;
    autoFallback?: boolean;
  }): Promise<HybridState> {
    const previous = await this.get();
    const next: HybridState = {
      ...previous,
      ...removeUndefined(update),
      updatedAt: new Date().toISOString(),
    };

    await this.persist(next);
    this.cachedState = next;
    return next;
  }

  async reset(): Promise<HybridState> {
    const next = createDefaultState(this.config.defaultModel);
    await this.persist(next);
    this.cachedState = next;
    return next;
  }

  private async persist(state: HybridState): Promise<void> {
    const directory = path.dirname(this.config.statePath);
    await fs.mkdir(directory, { recursive: true });

    const temporaryPath = `${this.config.statePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.config.statePath);
  }
}

function createDefaultState(defaultModel?: string): HybridState {
  return {
    provider: "ollama",
    model: defaultModel,
    autoFallback: true,
    updatedAt: new Date().toISOString(),
  };
}

function validateState(value: unknown): HybridState {
  if (!value || typeof value !== "object") {
    throw new HybridModelError("state_invalid", "Model state file is not an object");
  }

  const candidate = value as Partial<HybridState>;
  const provider = candidate.provider;

  if (provider !== "ollama" && provider !== "client") {
    throw new HybridModelError("state_invalid", "Model state provider is invalid");
  }

  return {
    provider,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    autoFallback:
      typeof candidate.autoFallback === "boolean" ? candidate.autoFallback : true,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}


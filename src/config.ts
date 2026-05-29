import os from "node:os";
import path from "node:path";
import type { AppConfig } from "./types.js";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_LITELLM_BASE_URL = "http://127.0.0.1:4000";
const DEFAULT_TIMEOUT_MS = 120_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const statePath =
    env.HYBRID_MODEL_STATE_PATH ??
    path.join(os.homedir(), ".hybrid-model-switcher", "state.json");
  const activeModelStatePath =
    env.HYBRID_ACTIVE_MODEL_STATE_PATH ??
    path.join(os.homedir(), ".hybrid-model-switcher", "active-model.json");

  return {
    ollamaBaseUrl: stripTrailingSlash(env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL),
    liteLlmBaseUrl: stripTrailingSlash(env.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL),
    liteLlmApiKey: normalizeOptionalString(env.LITELLM_API_KEY),
    liteLlmModelPrefix: normalizeOptionalString(env.LITELLM_LOCAL_MODEL_PREFIX),
    statePath,
    activeModelStatePath,
    requestTimeoutMs: parsePositiveInt(env.HYBRID_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    defaultModel: normalizeOptionalString(env.HYBRID_DEFAULT_MODEL),
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ModelStateManager } from "../src/state.js";

describe("ModelStateManager", () => {
  it("creates default state when no state file exists", async () => {
    const statePath = await temporaryStatePath();
    const manager = new ModelStateManager({
      statePath,
      defaultModel: "deepseek-r1:latest",
    });

    const state = await manager.get();

    expect(state.provider).toBe("ollama");
    expect(state.model).toBe("deepseek-r1:latest");
    expect(state.autoFallback).toBe(true);
  });

  it("persists updates", async () => {
    const statePath = await temporaryStatePath();
    const manager = new ModelStateManager({ statePath });

    await manager.set({
      provider: "ollama",
      model: "qwen3:latest",
      autoFallback: false,
    });

    const raw = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      provider: string;
      model: string;
      autoFallback: boolean;
    };

    expect(raw.provider).toBe("ollama");
    expect(raw.model).toBe("qwen3:latest");
    expect(raw.autoFallback).toBe(false);
  });
});

async function temporaryStatePath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-state-"));
  return path.join(directory, "state.json");
}


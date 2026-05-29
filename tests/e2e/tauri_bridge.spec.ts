import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AtomicActiveModelStateManager } from "../../src/tauri/config.js";

test("tray model switch updates active backend state without races", async ({ page }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tauri-bridge-"));
  const statePath = path.join(directory, "active-model.json");
  const manager = new AtomicActiveModelStateManager({ statePath });

  await page.exposeFunction(
    "hybridSwitchModel",
    async (input: { model: string; litellmModel?: string }) => {
      const state = await manager.setActiveModel({
        model: input.model,
        litellmModel: input.litellmModel,
        provider: "litellm",
      });
      return state;
    },
  );

  await page.addInitScript(() => {
    const bridge = {
      core: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command !== "hybrid_switch_model") {
            throw new Error(`Unexpected command: ${command}`);
          }

          return await window.hybridSwitchModel(args);
        },
      },
    };

    Object.defineProperty(window, "__TAURI__", {
      value: bridge,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  });

  await page.goto("about:blank");

  await page.setContent(`
    <button id="deepseek">DeepSeek R1</button>
    <button id="qwen">Qwen3</button>
    <script>
      const switchModel = (model) => window.__TAURI__.core.invoke("hybrid_switch_model", {
        model,
        litellmModel: "ollama_chat/" + model
      });
      document.querySelector("#deepseek").addEventListener("click", () => switchModel("deepseek-r1:latest"));
      document.querySelector("#qwen").addEventListener("click", () => switchModel("qwen3:latest"));
    </script>
  `);

  await page.locator("#deepseek").click();
  await expect
    .poll(async () => (await manager.getSnapshot()).model)
    .toBe("deepseek-r1:latest");

  await page.evaluate(async () => {
    await Promise.all([
      window.__TAURI__.core.invoke("hybrid_switch_model", {
        model: "qwen3:latest",
        litellmModel: "ollama_chat/qwen3:latest",
      }),
      window.__TAURI__.core.invoke("hybrid_switch_model", {
        model: "phi4:latest",
        litellmModel: "ollama_chat/phi4:latest",
      }),
    ]);
  });

  const finalState = await manager.getSnapshot();
  expect(finalState.revision).toBe(3);
  expect(["qwen3:latest", "phi4:latest"]).toContain(finalState.model);
});

declare global {
  interface Window {
    hybridSwitchModel(input: unknown): Promise<unknown>;
    __TAURI__: {
      core: {
        invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
      };
    };
  }
}

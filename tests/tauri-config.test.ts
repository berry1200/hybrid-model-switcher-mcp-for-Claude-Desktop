import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AtomicActiveModelStateManager,
  ClaudeDesktopHostConfigManager,
} from "../src/tauri/config.js";

describe("ClaudeDesktopHostConfigManager", () => {
  it("locates and parses a native Claude Desktop config", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "claude-config-"));
    const configPath = path.join(directory, "claude_desktop_config.json");

    await fs.writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          "hybrid-model-switcher": {
            command: "node",
            args: ["dist/index.js"],
          },
        },
      }),
      "utf8",
    );

    const manager = new ClaudeDesktopHostConfigManager({
      explicitConfigPath: configPath,
      homeDir: directory,
    });

    const config = await manager.readConfig();

    expect(config.mcpServers?.["hybrid-model-switcher"]?.command).toBe("node");
  });
});

describe("AtomicActiveModelStateManager", () => {
  it("serializes concurrent active-model switches into atomic revisions", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "active-model-"));
    const statePath = path.join(directory, "active-model.json");
    const manager = new AtomicActiveModelStateManager({ statePath });

    const updates = await Promise.all([
      manager.setActiveModel({ model: "deepseek-r1:latest" }),
      manager.setActiveModel({ model: "qwen3:latest" }),
    ]);

    const revisions = updates.map((state) => state.revision).sort();
    const final = await manager.getSnapshot();
    const raw = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      revision: number;
      model: string;
    };

    expect(revisions).toEqual([1, 2]);
    expect(final.revision).toBe(2);
    expect(raw.revision).toBe(2);
    expect(["deepseek-r1:latest", "qwen3:latest"]).toContain(raw.model);
  });
});


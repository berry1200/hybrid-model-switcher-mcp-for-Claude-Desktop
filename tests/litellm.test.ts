import { describe, expect, it } from "vitest";
import { translateAnthropicToLiteLlm } from "../src/routing/litellm.js";
import type { ActiveLocalModelState } from "../src/tauri/config.js";
import { PayloadTranslationError } from "../src/utils/errors.js";

const snapshot: ActiveLocalModelState = {
  provider: "litellm",
  model: "deepseek-r1:latest",
  autoFallback: true,
  revision: 3,
  updatedAt: "2026-05-20T00:00:00.000Z",
};

describe("translateAnthropicToLiteLlm", () => {
  it("translates Anthropic text messages into a LiteLLM chat payload", () => {
    const payload = translateAnthropicToLiteLlm(
      {
        system: "You are concise.",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 128,
        temperature: 0.2,
        metadata: { traceId: "abc" },
      },
      snapshot,
      "ollama_chat/deepseek-r1:latest",
    );

    expect(payload.model).toBe("ollama_chat/deepseek-r1:latest");
    expect(payload.messages).toEqual([
      { role: "system", content: "You are concise." },
      { role: "user", content: "Hello" },
    ]);
    expect(payload.metadata["hybrid.active_model"]).toBe("deepseek-r1:latest");
    expect(payload.metadata.traceId).toBe("abc");
    expect(payload.stream).toBe(false);
  });

  it("rejects tool-use payloads instead of silently dropping them", () => {
    expect(() =>
      translateAnthropicToLiteLlm(
        {
          messages: [{ role: "user", content: "Call a tool" }],
          tools: [{ name: "unsafe_drop" }],
        },
        snapshot,
        "ollama_chat/deepseek-r1:latest",
      ),
    ).toThrow(PayloadTranslationError);
  });
});


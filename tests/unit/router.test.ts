import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  LiteLlmRouter,
  translateAnthropicToOllamaChat,
  type AnthropicMessagesRequest,
} from "../../src/routing/litellm.js";
import type { ActiveLocalModelState } from "../../src/tauri/config.js";

const baseUrl = "http://127.0.0.1:4010";

const activeState: ActiveLocalModelState = {
  provider: "litellm",
  model: "deepseek-r1:latest",
  litellmModel: "ollama_chat/deepseek-r1:latest",
  fallbackModel: "ollama_chat/qwen3:latest",
  autoFallback: true,
  revision: 7,
  updatedAt: "2026-05-20T00:00:00.000Z",
};

let capturedRequest:
  | {
      headers: Record<string, string>;
      body: unknown;
    }
  | undefined;

const server = setupServer(
  http.post(`${baseUrl}/v1/chat/completions`, async ({ request }) => {
    capturedRequest = {
      headers: Object.fromEntries(request.headers.entries()),
      body: await request.json(),
    };

    return HttpResponse.json({
      choices: [
        {
          message: {
            content: "local response",
          },
        },
      ],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  capturedRequest = undefined;
  server.resetHandlers();
});
afterAll(() => server.close());

describe("router payload translation", () => {
  it("translates Anthropic messages into strict Ollama chat payloads", () => {
    const request: AnthropicMessagesRequest = {
      system: [{ type: "text", text: "Answer like a maintainer." }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this diagram." },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgo=",
              },
            },
          ],
        },
      ],
      max_tokens: 256,
      temperature: 0.1,
      top_p: 0.9,
      stop_sequences: ["</done>"],
    };

    const payload = translateAnthropicToOllamaChat(
      request,
      "deepseek-r1:latest",
    );

    expect(payload).toEqual({
      model: "deepseek-r1:latest",
      stream: false,
      messages: [
        {
          role: "system",
          content: "Answer like a maintainer.",
        },
        {
          role: "user",
          content: "Inspect this diagram.",
          images: ["iVBORw0KGgo="],
        },
      ],
      options: {
        temperature: 0.1,
        top_p: 0.9,
        num_predict: 256,
        stop: ["</done>"],
      },
    });
  });

  it("dispatches deterministic LiteLLM payloads with routing metadata and headers", async () => {
    const router = new LiteLlmRouter(
      {
        getRequiredSnapshot: async () => activeState,
      },
      {
        baseUrl,
        apiKey: "test-secret",
        timeoutMs: 1_000,
      },
    );

    const result = await router.dispatchAnthropic({
      messages: [{ role: "user", content: "Summarize the repo." }],
      metadata: { requestId: "unit-1" },
    });

    expect(result.text).toBe("local response");
    expect(result.model).toBe("ollama_chat/deepseek-r1:latest");
    expect(capturedRequest?.headers.authorization).toBe("Bearer test-secret");
    expect(capturedRequest?.headers["x-hybrid-route-kind"]).toBe(
      "anthropic-message",
    );
    expect(capturedRequest?.headers["x-hybrid-state-revision"]).toBe("7");
    expect(capturedRequest?.body).toMatchObject({
      model: "ollama_chat/deepseek-r1:latest",
      messages: [{ role: "user", content: "Summarize the repo." }],
      metadata: {
        requestId: "unit-1",
        "hybrid.provider": "litellm",
        "hybrid.active_model": "deepseek-r1:latest",
        "hybrid.revision": 7,
      },
    });
  });
});


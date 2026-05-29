import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHybridMcpProxyServer } from "../../src/mcp/server.js";
import { LiteLlmRouter } from "../../src/routing/litellm.js";
import type { HybridRouter } from "../../src/router.js";
import {
  AtomicActiveModelStateManager,
  type ActiveLocalModelState,
} from "../../src/tauri/config.js";

const baseUrl = "http://127.0.0.1:4011";

let capturedLifecycle:
  | {
      headers: Record<string, string>;
      body: unknown;
    }
  | undefined;

const lifecycleServer = setupServer(
  http.post(`${baseUrl}/hybrid/mcp/lifecycle`, async ({ request }) => {
    capturedLifecycle = {
      headers: Object.fromEntries(request.headers.entries()),
      body: await request.json(),
    };

    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => lifecycleServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  capturedLifecycle = undefined;
  lifecycleServer.resetHandlers();
});
afterAll(() => lifecycleServer.close());

describe("MCP lifecycle forwarding", () => {
  it("appends routing headers and forwards tools/list lifecycle fields to LiteLLM", async () => {
    const activeModelState = await createActiveState({
      provider: "litellm",
      model: "deepseek-r1:latest",
      litellmModel: "ollama_chat/deepseek-r1:latest",
      autoFallback: true,
      revision: 0,
      updatedAt: "2026-05-20T00:00:00.000Z",
    });
    await activeModelState.setActiveModel({
      model: "deepseek-r1:latest",
      litellmModel: "ollama_chat/deepseek-r1:latest",
      provider: "litellm",
    });

    const proxy = createHybridMcpProxyServer(
      {
        router: createRouterStub(),
        liteLlmRouter: new LiteLlmRouter(activeModelState, {
          baseUrl,
          timeoutMs: 1_000,
        }),
        activeModelState,
      },
      {
        requestTimeoutMs: 2_000,
      },
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "integration-client", version: "0.0.0" });

    await proxy.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();

    expect(tools.tools.some((tool) => tool.name === "hybrid_route_anthropic")).toBe(
      true,
    );
    expect(capturedLifecycle?.headers["x-hybrid-route-kind"]).toBe("tools/list");
    expect(capturedLifecycle?.headers["x-hybrid-provider"]).toBe("litellm");
    expect(capturedLifecycle?.headers["x-hybrid-active-model"]).toBe(
      "deepseek-r1:latest",
    );
    expect(capturedLifecycle?.headers["x-hybrid-litellm-model"]).toBe(
      "ollama_chat/deepseek-r1:latest",
    );
    expect(capturedLifecycle?.body).toMatchObject({
      method: "tools/list",
      params: {},
      routing: {
        provider: "litellm",
        activeModel: "deepseek-r1:latest",
        litellmModel: "ollama_chat/deepseek-r1:latest",
        revision: 1,
      },
    });
  });
});

async function createActiveState(
  initial: ActiveLocalModelState,
): Promise<AtomicActiveModelStateManager> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-lifecycle-"));
  const statePath = path.join(directory, "active-model.json");
  await fs.writeFile(statePath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  return new AtomicActiveModelStateManager({ statePath });
}

function createRouterStub(): HybridRouter {
  return {
    status: async () => ({}),
    listModels: async () => ({ localModels: [] }),
    setModel: async () => ({}),
    generate: async () => ({
      provider: "ollama",
      text: "",
      elapsedMs: 0,
    }),
    chat: async () => ({
      provider: "ollama",
      text: "",
      elapsedMs: 0,
    }),
  } as unknown as HybridRouter;
}


import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
  CoreMcpProxyServer,
  type McpProxyPipeline,
  type McpProxyPipelineContext,
} from "../src/mcp/server.js";

describe("CoreMcpProxyServer", () => {
  it("handles tools/list and tools/call through the pipeline", async () => {
    const pipeline: McpProxyPipeline = {
      async listTools(_request: ListToolsRequest): Promise<ListToolsResult> {
        return {
          tools: [
            {
              name: "hybrid_status",
              inputSchema: {
                type: "object",
                properties: {},
              },
            },
          ],
        };
      },
      async callTool(
        request: CallToolRequest,
        _context: McpProxyPipelineContext,
      ): Promise<CallToolResult> {
        return {
          content: [
            {
              type: "text",
              text: `called:${request.params.name}`,
            },
          ],
        };
      },
    };

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = new CoreMcpProxyServer({
      pipeline,
      requestTimeoutMs: 1_000,
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const result = await client.callTool({ name: "hybrid_status", arguments: {} });

    expect(tools.tools.map((tool) => tool.name)).toEqual(["hybrid_status"]);
    expect(result.content).toEqual([
      { type: "text", text: "called:hybrid_status" },
    ]);

    await client.close();
  });
});

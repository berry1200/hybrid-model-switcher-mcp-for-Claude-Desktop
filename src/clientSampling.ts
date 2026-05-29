import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ChatMessage, GenerationOptions, GenerationResult } from "./types.js";

interface ClientSamplingInput {
  messages: ChatMessage[];
  model?: string;
  options?: GenerationOptions;
}

export async function sampleWithClient(
  server: McpServer | Server,
  input: ClientSamplingInput,
): Promise<GenerationResult> {
  const startedAt = Date.now();
  const { messages, systemPrompt } = normalizeSamplingMessages(input.messages);
  const samplingServer = "server" in server ? server.server : server;

  const response = await samplingServer.createMessage({
    messages,
    systemPrompt,
    includeContext: "none",
    maxTokens: input.options?.num_predict ?? 1024,
    temperature: input.options?.temperature,
    stopSequences: input.options?.stop,
    modelPreferences: input.model
      ? {
          hints: [{ name: input.model }],
        }
      : undefined,
  });

  return {
    provider: "client",
    model: response.model,
    text: extractText(response.content),
    elapsedMs: Date.now() - startedAt,
    raw: response,
  };
}

function normalizeSamplingMessages(messages: ChatMessage[]): {
  messages: Array<{
    role: "user" | "assistant";
    content: { type: "text"; text: string };
  }>;
  systemPrompt?: string;
} {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const nonSystemMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: { type: "text" as const, text: message.content },
    }));

  return {
    messages:
      nonSystemMessages.length > 0
        ? nonSystemMessages
        : [{ role: "user", content: { type: "text", text: "" } }],
    systemPrompt: systemPrompt || undefined,
  };
}

function extractText(
  content:
    | { type: string; text?: string }
    | Array<{ type: string; text?: string }>,
): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => (block.type === "text" ? block.text ?? "" : ""))
    .join("\n")
    .trim();
}

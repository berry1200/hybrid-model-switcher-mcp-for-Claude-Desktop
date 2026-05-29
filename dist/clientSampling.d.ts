import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ChatMessage, GenerationOptions, GenerationResult } from "./types.js";
interface ClientSamplingInput {
    messages: ChatMessage[];
    model?: string;
    options?: GenerationOptions;
}
export declare function sampleWithClient(server: McpServer | Server, input: ClientSamplingInput): Promise<GenerationResult>;
export {};

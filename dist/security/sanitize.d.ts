import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
export declare function sanitizeToolCallRequest(request: CallToolRequest): CallToolRequest;
export declare function assertJsonSafe(value: unknown, path: string, depth?: number): void;

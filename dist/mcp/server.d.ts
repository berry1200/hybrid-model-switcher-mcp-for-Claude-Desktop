import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type CallToolRequest, type CallToolResult, type ListToolsRequest, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { type LiteLlmRouter } from "../routing/litellm.js";
import type { AtomicActiveModelStateManager, ClaudeDesktopHostConfigManager } from "../tauri/config.js";
import type { HybridRouter } from "../router.js";
import { TokenBucketRateLimiter } from "../utils/rateLimit.js";
export interface McpProxyPipelineContext {
    server: Server;
}
export interface McpProxyPipeline {
    listTools(request: ListToolsRequest): Promise<ListToolsResult>;
    callTool(request: CallToolRequest, context: McpProxyPipelineContext): Promise<CallToolResult>;
}
export interface HybridMcpProxyPipelineDependencies {
    router: HybridRouter;
    liteLlmRouter: LiteLlmRouter;
    activeModelState: AtomicActiveModelStateManager;
    hostConfig?: ClaudeDesktopHostConfigManager;
}
export interface CoreMcpProxyServerOptions {
    requestTimeoutMs?: number;
    pipeline: McpProxyPipeline;
    rateLimiter?: TokenBucketRateLimiter;
}
export declare class CoreMcpProxyServer {
    private readonly options;
    readonly server: Server;
    private readonly requestTimeoutMs;
    private readonly rateLimiter;
    constructor(options: CoreMcpProxyServerOptions);
    connect(transport: Transport): Promise<void>;
    connectStdio(): Promise<void>;
    private registerHandlers;
}
export declare class HybridMcpProxyPipeline implements McpProxyPipeline {
    private readonly deps;
    constructor(deps: HybridMcpProxyPipelineDependencies);
    listTools(_request: ListToolsRequest): Promise<ListToolsResult>;
    callTool(request: CallToolRequest, context: McpProxyPipelineContext): Promise<CallToolResult>;
    private status;
    private routeAnthropic;
    private setModel;
    private asJson;
}
export declare function createHybridMcpProxyServer(deps: HybridMcpProxyPipelineDependencies, options?: Omit<CoreMcpProxyServerOptions, "pipeline">): CoreMcpProxyServer;

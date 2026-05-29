import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { sampleWithClient } from "../clientSampling.js";
import { globalMetricsMonitor } from "../observability/metrics.js";
import { captureTelemetryError } from "../observability/telemetry.js";
import { recommendModel } from "../recommendations.js";
import { normalizeAnthropicRouteArgs } from "../routing/compatibility.js";
import { anthropicMessagesRequestSchema } from "../routing/litellm.js";
import { sanitizeToolCallRequest } from "../security/sanitize.js";
import { TokenBucketRateLimiter } from "../utils/rateLimit.js";
import { HybridModelError, PayloadTranslationError, safeToolErrorResult, withTimeout, } from "../utils/errors.js";
const SERVER_NAME = "hybrid-model-switcher";
const SERVER_VERSION = "0.2.0";
const DEFAULT_HANDLER_TIMEOUT_MS = 120_000;
const proxyProviderSchema = z.enum(["ollama", "client", "litellm"]);
const generationOptionsSchema = z
    .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().positive().optional(),
    num_ctx: z.number().int().positive().optional(),
    num_predict: z.number().int().positive().optional(),
    stop: z.array(z.string()).optional(),
})
    .optional();
const chatMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1),
});
const setModelArgsSchema = z.object({
    provider: proxyProviderSchema.optional(),
    model: z.string().min(1).optional(),
    litellmModel: z.string().min(1).optional(),
    fallbackModel: z.string().min(1).optional(),
    autoFallback: z.boolean().optional(),
});
const generateArgsSchema = z.object({
    prompt: z.string().min(1),
    system: z.string().optional(),
    provider: z.enum(["ollama", "client"]).optional(),
    model: z.string().min(1).optional(),
    options: generationOptionsSchema,
});
const chatArgsSchema = z.object({
    messages: z.array(chatMessageSchema).min(1),
    provider: z.enum(["ollama", "client"]).optional(),
    model: z.string().min(1).optional(),
    options: generationOptionsSchema,
});
const recommendArgsSchema = z.object({
    taskType: z.string().min(1),
});
const routeAnthropicArgsSchema = z.object({
    request: anthropicMessagesRequestSchema,
    modelOverride: z.string().min(1).optional(),
    fallbackModelOverride: z.string().min(1).optional(),
});
export class CoreMcpProxyServer {
    options;
    server;
    requestTimeoutMs;
    rateLimiter;
    constructor(options) {
        this.options = options;
        this.requestTimeoutMs =
            options.requestTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
        this.rateLimiter = options.rateLimiter ?? new TokenBucketRateLimiter();
        this.server = new Server({
            name: SERVER_NAME,
            version: SERVER_VERSION,
            description: "MCP routing proxy for Claude Desktop, LiteLLM, Ollama, and client sampling.",
        }, {
            capabilities: {
                tools: {
                    listChanged: true,
                },
            },
            instructions: "Use this proxy to discover local models, switch the active route, and explicitly route requests through Ollama or LiteLLM. It never modifies Claude Desktop internals.",
        });
        this.registerHandlers();
    }
    async connect(transport) {
        await this.server.connect(transport);
    }
    async connectStdio() {
        await this.connect(new StdioServerTransport());
    }
    registerHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
            return globalMetricsMonitor.trackRequest({
                routeKind: "tools/list",
                provider: "litellm",
            }, async () => {
                try {
                    return await withTimeout(this.options.pipeline.listTools(request), this.requestTimeoutMs, "tools/list handler timed out.");
                }
                catch (error) {
                    captureTelemetryError(error, {
                        code: errorCodeFromUnknown(error),
                        routeKind: "tools/list",
                        provider: "litellm",
                    });
                    return {
                        tools: [createDiagnosticTool(error)],
                    };
                }
            }, (result) => ({
                status: result.tools.some((tool) => tool.name === "hybrid_proxy_diagnostic")
                    ? "failed"
                    : "success",
                errorCode: result.tools.some((tool) => tool.name === "hybrid_proxy_diagnostic")
                    ? "tools_list_diagnostic"
                    : undefined,
            }));
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const toolName = request.params.name;
            return globalMetricsMonitor.trackRequest({
                routeKind: `tools/call:${toolName}`,
                provider: providerForTool(toolName),
            }, async () => {
                try {
                    const sanitizedRequest = sanitizeToolCallRequest(request);
                    const operation = () => this.options.pipeline.callTool(sanitizedRequest, { server: this.server });
                    const result = shouldRateLimitTool(sanitizedRequest.params.name)
                        ? this.rateLimiter.run(operation)
                        : operation();
                    return await withTimeout(result, this.requestTimeoutMs, `tools/call handler timed out for ${sanitizedRequest.params.name}.`);
                }
                catch (error) {
                    captureTelemetryError(error, {
                        code: errorCodeFromUnknown(error),
                        routeKind: `tools/call:${toolName}`,
                        provider: providerForTool(toolName),
                    });
                    return safeToolErrorResult(error);
                }
            }, (result) => ({
                status: result.isError ? "failed" : "success",
                errorCode: result.isError ? toolResultErrorCode(result) : undefined,
            }));
        });
    }
}
export class HybridMcpProxyPipeline {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async listTools(_request) {
        await this.deps.liteLlmRouter
            .forwardMcpLifecycleEvent("tools/list", _request)
            .catch(() => undefined);
        return {
            tools: CORE_PROXY_TOOLS,
        };
    }
    async callTool(request, context) {
        const args = request.params.arguments ?? {};
        switch (request.params.name) {
            case "hybrid_status":
                return this.asJson(await this.status());
            case "hybrid_list_models":
                return this.asJson(await this.deps.router.listModels());
            case "hybrid_set_model":
                return this.asJson(await this.setModel(parseArguments(setModelArgsSchema, args)));
            case "hybrid_generate":
                return this.asJson(await this.deps.router.generate(parseArguments(generateArgsSchema, args), (input) => sampleWithClient(context.server, input)));
            case "hybrid_chat":
                return this.asJson(await this.deps.router.chat(parseArguments(chatArgsSchema, args), (input) => sampleWithClient(context.server, input)));
            case "hybrid_route_anthropic":
                return this.routeAnthropic(args);
            case "hybrid_recommend_model":
                return this.asJson(recommendModel(parseArguments(recommendArgsSchema, args).taskType));
            default:
                throw new PayloadTranslationError(`Unknown tool requested: ${request.params.name}`, { toolName: request.params.name });
        }
    }
    async status() {
        const baseStatus = await this.deps.router.status();
        const activeModel = await this.deps.activeModelState.getSnapshot();
        const hostConfig = this.deps.hostConfig
            ? await this.deps.hostConfig
                .locateConfigPath()
                .then((configPath) => ({ ok: true, configPath }))
                .catch((error) => ({ ok: false, error: String(error) }))
            : undefined;
        return {
            ...baseStatus,
            activeModel,
            hostConfig,
            proxy: {
                version: SERVER_VERSION,
                mode: "low-level-tools-list-and-call-interceptor",
            },
        };
    }
    async routeAnthropic(args) {
        const normalizedArgs = normalizeAnthropicRouteArgs(args);
        const parsedArgs = routeAnthropicArgsSchema.parse(normalizedArgs);
        return this.asJson(await this.deps.liteLlmRouter.dispatchAnthropic(parsedArgs.request, {
            modelOverride: parsedArgs.modelOverride,
            fallbackModelOverride: parsedArgs.fallbackModelOverride,
        }));
    }
    async setModel(input) {
        const previous = await this.deps.activeModelState
            .getSnapshot()
            .catch(() => undefined);
        try {
            const legacyProvider = input.provider === "litellm" ? undefined : input.provider;
            const legacy = legacyProvider || input.model
                ? await this.deps.router.setModel({
                    provider: legacyProvider,
                    model: input.provider === "litellm" ? undefined : input.model,
                    autoFallback: input.autoFallback,
                })
                : undefined;
            const active = input.model || input.litellmModel
                ? await this.deps.activeModelState.setActiveModel({
                    model: input.model ?? input.litellmModel ?? "",
                    provider: input.provider === "ollama"
                        ? "ollama"
                        : input.provider === "client"
                            ? "client"
                            : "litellm",
                    litellmModel: input.litellmModel,
                    fallbackModel: input.fallbackModel,
                    autoFallback: input.autoFallback,
                })
                : input.autoFallback === undefined
                    ? await this.deps.activeModelState.getSnapshot()
                    : await this.deps.activeModelState.setAutoFallback(input.autoFallback);
            globalMetricsMonitor.recordModelSwitch({
                status: "success",
                from: modelLabel(previous),
                to: modelLabel(active),
            });
            return {
                legacy,
                active,
                note: "The proxy route changed. Claude Desktop's native model selector is unchanged.",
            };
        }
        catch (error) {
            globalMetricsMonitor.recordModelSwitch({
                status: "failed",
                from: modelLabel(previous),
                to: requestedModelLabel(input),
                errorCode: errorCodeFromUnknown(error),
            });
            throw error;
        }
    }
    asJson(value) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(value, null, 2),
                },
            ],
            structuredContent: {
                result: value,
            },
        };
    }
}
export function createHybridMcpProxyServer(deps, options = {}) {
    return new CoreMcpProxyServer({
        ...options,
        pipeline: new HybridMcpProxyPipeline(deps),
    });
}
function parseArguments(schema, args) {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
        throw new PayloadTranslationError("Tool arguments failed validation.", parsed.error.flatten());
    }
    return parsed.data;
}
function createDiagnosticTool(error) {
    return {
        name: "hybrid_proxy_diagnostic",
        title: "Hybrid Proxy Diagnostic",
        description: "Fallback diagnostic tool exposed when the proxy cannot enumerate its normal tool pipeline.",
        inputSchema: {
            type: "object",
            properties: {},
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
        },
        _meta: {
            error: String(error),
        },
    };
}
function shouldRateLimitTool(name) {
    return new Set([
        "hybrid_generate",
        "hybrid_chat",
        "hybrid_route_anthropic",
    ]).has(name);
}
function providerForTool(name) {
    if (name === "hybrid_route_anthropic") {
        return "litellm";
    }
    if (name === "hybrid_generate" ||
        name === "hybrid_chat" ||
        name === "hybrid_list_models") {
        return "ollama";
    }
    if (name === "hybrid_set_model") {
        return "unknown";
    }
    return "client";
}
function toolResultErrorCode(result) {
    const structured = result.structuredContent;
    if (!structured || typeof structured !== "object" || !("error" in structured)) {
        return undefined;
    }
    const error = structured.error;
    if (!error || typeof error !== "object" || !("code" in error)) {
        return undefined;
    }
    return String(error.code);
}
function errorCodeFromUnknown(error) {
    if (error instanceof HybridModelError) {
        return error.code;
    }
    if (error && typeof error === "object" && "code" in error) {
        return String(error.code);
    }
    return "unknown_error";
}
function modelLabel(state) {
    if (!state) {
        return undefined;
    }
    return `${state.provider}:${state.litellmModel ?? state.model ?? "unset"}`;
}
function requestedModelLabel(input) {
    const provider = input.provider ?? "litellm";
    const model = input.litellmModel ?? input.model;
    return model ? `${provider}:${model}` : undefined;
}
const noArgsSchema = {
    type: "object",
    properties: {},
};
const generationOptionsJsonSchema = {
    type: "object",
    properties: {
        temperature: { type: "number", minimum: 0, maximum: 2 },
        top_p: { type: "number", minimum: 0, maximum: 1 },
        top_k: { type: "integer", minimum: 1 },
        num_ctx: { type: "integer", minimum: 1 },
        num_predict: { type: "integer", minimum: 1 },
        stop: {
            type: "array",
            items: { type: "string" },
        },
    },
};
const CORE_PROXY_TOOLS = [
    {
        name: "hybrid_status",
        title: "Hybrid Status",
        description: "Check MCP proxy health, Ollama status, active model state, and host configuration status.",
        inputSchema: noArgsSchema,
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    {
        name: "hybrid_list_models",
        title: "List Hybrid Models",
        description: "List installed Ollama models and recommended local model profiles.",
        inputSchema: noArgsSchema,
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    {
        name: "hybrid_set_model",
        title: "Set Hybrid Model",
        description: "Persist the active model route for Ollama, LiteLLM, or client sampling.",
        inputSchema: {
            type: "object",
            properties: {
                provider: {
                    type: "string",
                    enum: ["ollama", "client", "litellm"],
                },
                model: {
                    type: "string",
                    minLength: 1,
                },
                litellmModel: {
                    type: "string",
                    minLength: 1,
                },
                fallbackModel: {
                    type: "string",
                    minLength: 1,
                },
                autoFallback: {
                    type: "boolean",
                },
            },
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    },
    {
        name: "hybrid_generate",
        title: "Generate With Hybrid Model",
        description: "Generate text using the active Phase 1 route: Ollama or MCP client sampling.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    minLength: 1,
                },
                system: {
                    type: "string",
                },
                provider: {
                    type: "string",
                    enum: ["ollama", "client"],
                },
                model: {
                    type: "string",
                    minLength: 1,
                },
                options: generationOptionsJsonSchema,
            },
            required: ["prompt"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    {
        name: "hybrid_chat",
        title: "Chat With Hybrid Model",
        description: "Generate a chat response using the active Phase 1 route: Ollama or MCP client sampling.",
        inputSchema: {
            type: "object",
            properties: {
                messages: {
                    type: "array",
                    minItems: 1,
                    items: {
                        type: "object",
                        properties: {
                            role: {
                                type: "string",
                                enum: ["system", "user", "assistant"],
                            },
                            content: {
                                type: "string",
                                minLength: 1,
                            },
                        },
                        required: ["role", "content"],
                    },
                },
                provider: {
                    type: "string",
                    enum: ["ollama", "client"],
                },
                model: {
                    type: "string",
                    minLength: 1,
                },
                options: generationOptionsJsonSchema,
            },
            required: ["messages"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    {
        name: "hybrid_route_anthropic",
        title: "Route Anthropic Payload Through LiteLLM",
        description: "Translate an Anthropic-style message request and dispatch it through the active LiteLLM local model route.",
        inputSchema: {
            type: "object",
            properties: {
                request: {
                    type: "object",
                    properties: {
                        model: { type: "string" },
                        max_tokens: { type: "integer", minimum: 1 },
                        system: {
                            oneOf: [
                                { type: "string" },
                                {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            type: { const: "text" },
                                            text: { type: "string" },
                                        },
                                        required: ["type", "text"],
                                    },
                                },
                            ],
                        },
                        messages: {
                            type: "array",
                            minItems: 1,
                            items: {
                                type: "object",
                                properties: {
                                    role: {
                                        type: "string",
                                        enum: ["user", "assistant"],
                                    },
                                    content: {
                                        oneOf: [
                                            { type: "string" },
                                            {
                                                type: "array",
                                                minItems: 1,
                                                items: {
                                                    type: "object",
                                                },
                                            },
                                        ],
                                    },
                                },
                                required: ["role", "content"],
                            },
                        },
                        temperature: { type: "number", minimum: 0, maximum: 2 },
                        top_p: { type: "number", minimum: 0, maximum: 1 },
                        stop_sequences: {
                            type: "array",
                            items: { type: "string" },
                        },
                        stream: { type: "boolean" },
                        metadata: {
                            type: "object",
                        },
                    },
                    required: ["messages"],
                },
                modelOverride: {
                    type: "string",
                    minLength: 1,
                },
                fallbackModelOverride: {
                    type: "string",
                    minLength: 1,
                },
            },
            required: ["request"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    {
        name: "hybrid_recommend_model",
        title: "Recommend Local Model",
        description: "Recommend a local model for reasoning, coding, balanced, chat, or fast tasks.",
        inputSchema: {
            type: "object",
            properties: {
                taskType: {
                    type: "string",
                    minLength: 1,
                },
            },
            required: ["taskType"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
        },
    },
];
//# sourceMappingURL=server.js.map
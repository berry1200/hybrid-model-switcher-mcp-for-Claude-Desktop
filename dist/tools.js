import * as z from "zod/v4";
import { sampleWithClient } from "./clientSampling.js";
import { recommendModel } from "./recommendations.js";
import { PROVIDERS } from "./types.js";
const providerSchema = z.enum(PROVIDERS);
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
export function registerHybridTools(server, router) {
    server.registerTool("hybrid_status", {
        title: "Hybrid Status",
        description: "Check Ollama health, active model state, and routing config.",
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
        },
    }, async () => jsonResult(await router.status()));
    server.registerTool("hybrid_list_models", {
        title: "List Hybrid Models",
        description: "List installed Ollama models and recommended local model profiles.",
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async () => jsonResult(await router.listModels()));
    server.registerTool("hybrid_set_model", {
        title: "Set Hybrid Model",
        description: "Persist the active MCP routing provider and model. Does not change Claude Desktop's native model selector.",
        inputSchema: {
            provider: providerSchema.optional(),
            model: z.string().min(1).optional(),
            autoFallback: z.boolean().optional(),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ provider, model, autoFallback }) => jsonResult(await router.setModel({ provider, model, autoFallback })));
    server.registerTool("hybrid_generate", {
        title: "Generate With Hybrid Model",
        description: "Generate text using the active provider, an explicit Ollama model, or client sampling.",
        inputSchema: {
            prompt: z.string().min(1),
            system: z.string().optional(),
            provider: providerSchema.optional(),
            model: z.string().min(1).optional(),
            options: generationOptionsSchema,
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async ({ prompt, system, provider, model, options }) => jsonResult(await router.generate({ prompt, system, provider, model, options }, (input) => sampleWithClient(server, input))));
    server.registerTool("hybrid_chat", {
        title: "Chat With Hybrid Model",
        description: "Generate a response from a chat-style message array.",
        inputSchema: {
            messages: z.array(chatMessageSchema).min(1),
            provider: providerSchema.optional(),
            model: z.string().min(1).optional(),
            options: generationOptionsSchema,
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async ({ messages, provider, model, options }) => jsonResult(await router.chat({ messages, provider, model, options }, (input) => sampleWithClient(server, input))));
    server.registerTool("hybrid_recommend_model", {
        title: "Recommend Local Model",
        description: "Recommend a local Ollama model for reasoning, coding, balanced, chat, or fast tasks.",
        inputSchema: {
            taskType: z.string().min(1),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
        },
    }, async ({ taskType }) => jsonResult(recommendModel(taskType)));
}
function jsonResult(value) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, null, 2),
            },
        ],
    };
}
//# sourceMappingURL=tools.js.map
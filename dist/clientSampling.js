export async function sampleWithClient(server, input) {
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
function normalizeSamplingMessages(messages) {
    const systemPrompt = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
    const nonSystemMessages = messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
        role: message.role,
        content: { type: "text", text: message.content },
    }));
    return {
        messages: nonSystemMessages.length > 0
            ? nonSystemMessages
            : [{ role: "user", content: { type: "text", text: "" } }],
        systemPrompt: systemPrompt || undefined,
    };
}
function extractText(content) {
    const blocks = Array.isArray(content) ? content : [content];
    return blocks
        .map((block) => (block.type === "text" ? block.text ?? "" : ""))
        .join("\n")
        .trim();
}
//# sourceMappingURL=clientSampling.js.map
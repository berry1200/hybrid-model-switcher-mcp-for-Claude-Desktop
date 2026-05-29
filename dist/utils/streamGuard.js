import { McpTimeoutError, RouterConnectionError } from "./errors.js";
const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
export async function collectGuardedTextStream(source, options = {}) {
    const controller = new AbortController();
    const timeout = createTimeout(options.timeoutMs, controller);
    const abortListener = createAbortForwarder(options.signal, controller);
    const decoder = new TextDecoder();
    let reader;
    const chunks = [];
    let chunksRead = 0;
    let bytesRead = 0;
    let aborted = false;
    try {
        if (isReadableStream(source)) {
            reader = source.getReader();
            while (true) {
                throwIfAborted(controller.signal);
                const result = await reader.read();
                if (result.done) {
                    break;
                }
                const text = normalizeChunk(result.value, decoder);
                bytesRead += byteLength(text);
                chunksRead += 1;
                assertBufferLimit(bytesRead, options.maxBufferedBytes);
                await options.onChunk?.(text);
                chunks.push(text);
            }
        }
        else {
            for await (const chunk of source) {
                throwIfAborted(controller.signal);
                const text = normalizeChunk(chunk, decoder);
                bytesRead += byteLength(text);
                chunksRead += 1;
                assertBufferLimit(bytesRead, options.maxBufferedBytes);
                await options.onChunk?.(text);
                chunks.push(text);
            }
        }
        return {
            text: chunks.join(""),
            chunksRead,
            bytesRead,
            aborted,
            closedAt: new Date().toISOString(),
        };
    }
    catch (error) {
        aborted = controller.signal.aborted;
        if (aborted) {
            throw new McpTimeoutError("LLM text stream was aborted before completion.", {
                chunksRead,
                bytesRead,
            });
        }
        throw error;
    }
    finally {
        if (timeout) {
            clearTimeout(timeout);
        }
        if (abortListener) {
            options.signal?.removeEventListener("abort", abortListener);
        }
        if (reader) {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
        chunks.length = 0;
        if (options.forceGarbageCollection) {
            forceGarbageCollection();
        }
    }
}
export async function pipeGuardedTextStream(source, sink, options = {}) {
    const writer = sink.getWriter();
    try {
        return await collectGuardedTextStream(source, {
            ...options,
            onChunk: async (chunk) => {
                await writer.ready;
                await writer.write(chunk);
            },
        });
    }
    finally {
        await writer.close().catch(async (error) => {
            await writer.abort(error).catch(() => undefined);
        });
        writer.releaseLock();
    }
}
function createTimeout(timeoutMs, controller) {
    if (!timeoutMs) {
        return undefined;
    }
    return setTimeout(() => controller.abort(), timeoutMs);
}
function createAbortForwarder(signal, controller) {
    if (!signal) {
        return undefined;
    }
    const listener = () => controller.abort(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    return listener;
}
function isReadableStream(source) {
    return typeof source.getReader === "function";
}
function normalizeChunk(chunk, decoder) {
    return typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
}
function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}
function assertBufferLimit(bytesRead, maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES) {
    if (bytesRead > maxBufferedBytes) {
        throw new RouterConnectionError("LLM text stream exceeded the configured memory guard limit.", {
            bytesRead,
            maxBufferedBytes,
        });
    }
}
function throwIfAborted(signal) {
    if (signal.aborted) {
        throw new McpTimeoutError("LLM text stream was aborted.", {
            reason: signal.reason,
        });
    }
}
function forceGarbageCollection() {
    const candidate = globalThis;
    candidate.gc?.();
}
//# sourceMappingURL=streamGuard.js.map
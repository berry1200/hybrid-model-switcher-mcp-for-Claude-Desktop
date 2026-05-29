import { McpTimeoutError, RouterConnectionError } from "./errors.js";

export type TextStreamSource =
  | AsyncIterable<string | Uint8Array>
  | ReadableStream<string | Uint8Array>;

export interface GuardedStreamOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBufferedBytes?: number;
  onChunk?: (chunk: string) => void | Promise<void>;
  forceGarbageCollection?: boolean;
}

export interface GuardedStreamResult {
  text: string;
  chunksRead: number;
  bytesRead: number;
  aborted: boolean;
  closedAt: string;
}

const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export async function collectGuardedTextStream(
  source: TextStreamSource,
  options: GuardedStreamOptions = {},
): Promise<GuardedStreamResult> {
  const controller = new AbortController();
  const timeout = createTimeout(options.timeoutMs, controller);
  const abortListener = createAbortForwarder(options.signal, controller);
  const decoder = new TextDecoder();
  let reader: ReadableStreamDefaultReader<string | Uint8Array> | undefined;
  const chunks: string[] = [];
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
    } else {
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
  } catch (error) {
    aborted = controller.signal.aborted;

    if (aborted) {
      throw new McpTimeoutError("LLM text stream was aborted before completion.", {
        chunksRead,
        bytesRead,
      });
    }

    throw error;
  } finally {
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

export async function pipeGuardedTextStream(
  source: TextStreamSource,
  sink: WritableStream<string>,
  options: Omit<GuardedStreamOptions, "onChunk"> = {},
): Promise<GuardedStreamResult> {
  const writer = sink.getWriter();

  try {
    return await collectGuardedTextStream(source, {
      ...options,
      onChunk: async (chunk) => {
        await writer.ready;
        await writer.write(chunk);
      },
    });
  } finally {
    await writer.close().catch(async (error) => {
      await writer.abort(error).catch(() => undefined);
    });
    writer.releaseLock();
  }
}

function createTimeout(
  timeoutMs: number | undefined,
  controller: AbortController,
): NodeJS.Timeout | undefined {
  if (!timeoutMs) {
    return undefined;
  }

  return setTimeout(() => controller.abort(), timeoutMs);
}

function createAbortForwarder(
  signal: AbortSignal | undefined,
  controller: AbortController,
): (() => void) | undefined {
  if (!signal) {
    return undefined;
  }

  const listener = () => controller.abort(signal.reason);
  signal.addEventListener("abort", listener, { once: true });
  return listener;
}

function isReadableStream(source: TextStreamSource): source is ReadableStream<string | Uint8Array> {
  return typeof (source as ReadableStream).getReader === "function";
}

function normalizeChunk(chunk: string | Uint8Array, decoder: TextDecoder): string {
  return typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertBufferLimit(bytesRead: number, maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES): void {
  if (bytesRead > maxBufferedBytes) {
    throw new RouterConnectionError("LLM text stream exceeded the configured memory guard limit.", {
      bytesRead,
      maxBufferedBytes,
    });
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new McpTimeoutError("LLM text stream was aborted.", {
      reason: signal.reason,
    });
  }
}

function forceGarbageCollection(): void {
  const candidate = globalThis as typeof globalThis & {
    gc?: () => void;
  };

  candidate.gc?.();
}

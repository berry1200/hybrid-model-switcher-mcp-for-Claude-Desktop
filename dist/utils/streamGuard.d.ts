export type TextStreamSource = AsyncIterable<string | Uint8Array> | ReadableStream<string | Uint8Array>;
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
export declare function collectGuardedTextStream(source: TextStreamSource, options?: GuardedStreamOptions): Promise<GuardedStreamResult>;
export declare function pipeGuardedTextStream(source: TextStreamSource, sink: WritableStream<string>, options?: Omit<GuardedStreamOptions, "onChunk">): Promise<GuardedStreamResult>;

export interface TokenBucketRateLimiterOptions {
    capacity: number;
    refillTokens: number;
    refillIntervalMs: number;
    maxConcurrent: number;
    maxQueueSize: number;
    acquireTimeoutMs: number;
}
export interface RateLimiterSnapshot {
    capacity: number;
    availableTokens: number;
    activeCount: number;
    queuedCount: number;
    closed: boolean;
}
export declare class TokenBucketRateLimiter {
    private readonly options;
    private queue;
    private availableTokens;
    private activeCount;
    private lastRefillAt;
    private closed;
    private wakeTimer;
    constructor(options?: Partial<TokenBucketRateLimiterOptions>);
    run<T>(operation: () => Promise<T>): Promise<T>;
    snapshot(): RateLimiterSnapshot;
    close(reason?: string): void;
    private pump;
    private execute;
    private refill;
    private msUntilNextRefill;
    private removeEntry;
}

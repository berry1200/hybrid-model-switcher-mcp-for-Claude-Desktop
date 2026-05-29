import { McpTimeoutError, RouterConnectionError } from "./errors.js";
const DEFAULT_OPTIONS = {
    capacity: 8,
    refillTokens: 4,
    refillIntervalMs: 1_000,
    maxConcurrent: 4,
    maxQueueSize: 64,
    acquireTimeoutMs: 30_000,
};
export class TokenBucketRateLimiter {
    options;
    queue = [];
    availableTokens;
    activeCount = 0;
    lastRefillAt = Date.now();
    closed = false;
    wakeTimer;
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        validateOptions(this.options);
        this.availableTokens = this.options.capacity;
    }
    run(operation) {
        if (this.closed) {
            return Promise.reject(new RouterConnectionError("Rate limiter is closed; refusing new work."));
        }
        if (this.queue.length >= this.options.maxQueueSize) {
            return Promise.reject(new RouterConnectionError("Rate limiter queue is full.", this.snapshot()));
        }
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.removeEntry(entry);
                reject(new McpTimeoutError("Timed out waiting for local model capacity.", {
                    acquireTimeoutMs: this.options.acquireTimeoutMs,
                    snapshot: this.snapshot(),
                }));
            }, this.options.acquireTimeoutMs);
            const entry = {
                operation: operation,
                resolve: resolve,
                reject,
                timeout,
            };
            this.queue.push(entry);
            this.pump();
        });
    }
    snapshot() {
        this.refill();
        return {
            capacity: this.options.capacity,
            availableTokens: this.availableTokens,
            activeCount: this.activeCount,
            queuedCount: this.queue.length,
            closed: this.closed,
        };
    }
    close(reason = "Rate limiter closed.") {
        this.closed = true;
        if (this.wakeTimer) {
            clearTimeout(this.wakeTimer);
            this.wakeTimer = undefined;
        }
        const error = new RouterConnectionError(reason);
        const pending = this.queue.splice(0);
        for (const entry of pending) {
            clearTimeout(entry.timeout);
            entry.reject(error);
        }
    }
    pump() {
        if (this.closed) {
            return;
        }
        this.refill();
        while (this.queue.length > 0 &&
            this.activeCount < this.options.maxConcurrent &&
            this.availableTokens > 0) {
            const entry = this.queue.shift();
            if (!entry) {
                return;
            }
            clearTimeout(entry.timeout);
            this.availableTokens -= 1;
            this.activeCount += 1;
            void this.execute(entry);
        }
        if (this.queue.length > 0 && !this.wakeTimer) {
            this.wakeTimer = setTimeout(() => {
                this.wakeTimer = undefined;
                this.pump();
            }, this.msUntilNextRefill());
        }
    }
    async execute(entry) {
        try {
            entry.resolve(await entry.operation());
        }
        catch (error) {
            entry.reject(error);
        }
        finally {
            this.activeCount -= 1;
            this.pump();
        }
    }
    refill() {
        const now = Date.now();
        const intervals = Math.floor((now - this.lastRefillAt) / this.options.refillIntervalMs);
        if (intervals <= 0) {
            return;
        }
        this.availableTokens = Math.min(this.options.capacity, this.availableTokens + intervals * this.options.refillTokens);
        this.lastRefillAt += intervals * this.options.refillIntervalMs;
    }
    msUntilNextRefill() {
        const elapsed = Date.now() - this.lastRefillAt;
        return Math.max(1, this.options.refillIntervalMs - elapsed);
    }
    removeEntry(entry) {
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
            this.queue.splice(index, 1);
        }
    }
}
function validateOptions(options) {
    const entries = Object.entries(options);
    for (const [key, value] of entries) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new RouterConnectionError(`Invalid rate limiter option: ${key}`, {
                key,
                value,
            });
        }
    }
}
//# sourceMappingURL=rateLimit.js.map
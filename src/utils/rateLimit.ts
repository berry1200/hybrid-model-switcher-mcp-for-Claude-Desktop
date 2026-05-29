import { McpTimeoutError, RouterConnectionError } from "./errors.js";

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

interface QueueEntry {
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

const DEFAULT_OPTIONS: TokenBucketRateLimiterOptions = {
  capacity: 8,
  refillTokens: 4,
  refillIntervalMs: 1_000,
  maxConcurrent: 4,
  maxQueueSize: 64,
  acquireTimeoutMs: 30_000,
};

export class TokenBucketRateLimiter {
  private readonly options: TokenBucketRateLimiterOptions;
  private queue: QueueEntry[] = [];
  private availableTokens: number;
  private activeCount = 0;
  private lastRefillAt = Date.now();
  private closed = false;
  private wakeTimer: NodeJS.Timeout | undefined;

  constructor(options: Partial<TokenBucketRateLimiterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    validateOptions(this.options);
    this.availableTokens = this.options.capacity;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new RouterConnectionError("Rate limiter is closed; refusing new work."),
      );
    }

    if (this.queue.length >= this.options.maxQueueSize) {
      return Promise.reject(
        new RouterConnectionError("Rate limiter queue is full.", this.snapshot()),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeEntry(entry);
        reject(
          new McpTimeoutError("Timed out waiting for local model capacity.", {
            acquireTimeoutMs: this.options.acquireTimeoutMs,
            snapshot: this.snapshot(),
          }),
        );
      }, this.options.acquireTimeoutMs);

      const entry: QueueEntry = {
        operation: operation as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      };

      this.queue.push(entry);
      this.pump();
    });
  }

  snapshot(): RateLimiterSnapshot {
    this.refill();
    return {
      capacity: this.options.capacity,
      availableTokens: this.availableTokens,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      closed: this.closed,
    };
  }

  close(reason = "Rate limiter closed."): void {
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

  private pump(): void {
    if (this.closed) {
      return;
    }

    this.refill();

    while (
      this.queue.length > 0 &&
      this.activeCount < this.options.maxConcurrent &&
      this.availableTokens > 0
    ) {
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

  private async execute(entry: QueueEntry): Promise<void> {
    try {
      entry.resolve(await entry.operation());
    } catch (error) {
      entry.reject(error);
    } finally {
      this.activeCount -= 1;
      this.pump();
    }
  }

  private refill(): void {
    const now = Date.now();
    const intervals = Math.floor((now - this.lastRefillAt) / this.options.refillIntervalMs);

    if (intervals <= 0) {
      return;
    }

    this.availableTokens = Math.min(
      this.options.capacity,
      this.availableTokens + intervals * this.options.refillTokens,
    );
    this.lastRefillAt += intervals * this.options.refillIntervalMs;
  }

  private msUntilNextRefill(): number {
    const elapsed = Date.now() - this.lastRefillAt;
    return Math.max(1, this.options.refillIntervalMs - elapsed);
  }

  private removeEntry(entry: QueueEntry): void {
    const index = this.queue.indexOf(entry);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }
}

function validateOptions(options: TokenBucketRateLimiterOptions): void {
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

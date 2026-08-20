import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import { createLogger } from "@holymedia/observability";
import { Redis } from "ioredis";

@Injectable()
export class RedisRateLimitService implements OnModuleDestroy {
  private readonly config = loadConfig();
  private readonly redis = new Redis(this.config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  private readonly logger = createLogger(
    "holymedia-mcp-v2-rate-limit",
    this.config.logLevel,
  );

  public async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    try {
      if (this.redis.status === "wait") {
        await this.redis.connect();
      }
      const result = await this.redis
        .multi()
        .incr(key)
        .expire(key, windowSeconds)
        .exec();
      const count = Number(result?.[0]?.[1] ?? 0);
      if (count > limit) {
        throw new RateLimitExceededError();
      }
    } catch (error) {
      if (error instanceof RateLimitExceededError) throw error;
      this.logger.warn(
        {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
        "rate limiter unavailable",
      );
      if (this.config.configStrict) {
        throw new ServiceUnavailableException(
          "Authentication protection is temporarily unavailable.",
        );
      }
    }
  }

  public async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

export class RateLimitExceededError extends Error {
  public constructor() {
    super("Rate limit exceeded");
    this.name = "RateLimitExceededError";
  }
}

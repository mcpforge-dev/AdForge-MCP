import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

@Injectable()
export class ProviderRefreshCoordinator {
  private readonly config = loadConfig();
  private readonly redis = new Redis(this.config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  private connectPromise: Promise<void> | undefined;

  public async withLock<T>(
    connectionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.ensureConnected();
    const key = `v2:provider-refresh:${connectionId}`;
    const token = randomUUID();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const locked = await this.redis.set(key, token, "PX", 10_000, "NX");
      if (locked === "OK") {
        try {
          return await operation();
        } finally {
          await this.redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            key,
            token,
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ServiceUnavailableException(
      "Provider refresh is busy. Please retry shortly.",
    );
  }

  public async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === "ready") return;
    if (!this.connectPromise) {
      this.connectPromise = (
        this.redis.status === "wait" ? this.redis.connect() : Promise.resolve()
      ).finally(() => {
        this.connectPromise = undefined;
      });
    }
    await this.connectPromise;
  }
}

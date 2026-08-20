import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import {
  RateLimitExceededError,
  RedisRateLimitService,
} from "./redis-rate-limit.service.js";

const enabled =
  process.env.V2_INTEGRATION_TESTS === "true" && Boolean(process.env.REDIS_URL);
const suite = enabled ? describe : describe.skip;

suite("Redis integration", () => {
  const redis = new Redis(process.env.REDIS_URL!);

  afterAll(async () => {
    await redis.quit();
  });

  it("responds to ping", async () => {
    expect(await redis.ping()).toBe("PONG");
  });

  it("enforces a Redis-backed limit and releases the key after expiration", async () => {
    const service = new RedisRateLimitService();
    const key = `v2-test-rate-limit:${Date.now()}`;
    await service.consume(key, 1, 1);
    await expect(service.consume(key, 1, 1)).rejects.toBeInstanceOf(
      RateLimitExceededError,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await expect(service.consume(key, 1, 1)).resolves.toBeUndefined();
    await service.onModuleDestroy();
  });
});

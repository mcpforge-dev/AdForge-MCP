import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";

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
});

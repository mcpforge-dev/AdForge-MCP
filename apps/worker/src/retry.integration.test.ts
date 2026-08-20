import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Queue, Worker } from "bullmq";

const enabled =
  process.env.V2_INTEGRATION_TESTS === "true" && Boolean(process.env.REDIS_URL);
const suite = enabled ? describe : describe.skip;

function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

suite("BullMQ integration", () => {
  const resources: Array<{ queue: Queue; worker: Worker }> = [];

  afterEach(async () => {
    for (const resource of resources.splice(0)) {
      await resource.worker.close();
      await resource.queue.close();
    }
  });

  it("retries a failed job and shuts the worker down gracefully", async () => {
    const queueName = `v2-retry-${randomUUID()}`;
    const connection = redisConnection(process.env.REDIS_URL!);
    const queue = new Queue(queueName, { connection });
    let attempts = 0;
    const worker = new Worker(
      queueName,
      async (job) => {
        attempts += 1;
        if (job.attemptsMade === 0) {
          throw new Error("intentional integration retry");
        }
        return { attempts: job.attemptsMade + 1 };
      },
      { connection, concurrency: 1 },
    );
    worker.on("failed", () => undefined);
    resources.push({ queue, worker });

    const completed = new Promise<{ attempts: number }>((resolve, reject) => {
      worker.once("completed", (job, result) => resolve(result));
      worker.once("error", reject);
    });
    await queue.add(
      "retry.integration",
      { createdAt: new Date().toISOString() },
      { attempts: 2, backoff: { type: "fixed", delay: 50 } },
    );
    await expect(completed).resolves.toEqual({ attempts: 2 });
    expect(attempts).toBe(2);
  });
});

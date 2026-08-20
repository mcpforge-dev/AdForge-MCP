import { afterEach, describe, expect, it } from "vitest";
import { Queue, Worker } from "bullmq";
import {
  PROVIDER_DISCOVERY_QUEUE,
  enqueueProviderDiscovery,
  redisConnection,
  type ProviderDiscoveryJobData,
} from "./provider-discovery.job.js";

const enabled =
  process.env.V2_INTEGRATION_TESTS === "true" && Boolean(process.env.REDIS_URL);
const suite = enabled ? describe : describe.skip;

suite("provider discovery worker boundary", () => {
  const resources: Array<{ queue: Queue; worker: Worker }> = [];

  afterEach(async () => {
    for (const resource of resources.splice(0)) {
      await resource.worker.close();
      await resource.queue.close();
    }
  });

  it("deduplicates discovery jobs by connection id", async () => {
    const connection = redisConnection(process.env.REDIS_URL!);
    const queue = new Queue<ProviderDiscoveryJobData>(
      PROVIDER_DISCOVERY_QUEUE,
      {
        connection,
      },
    );
    const processed: string[] = [];
    const worker = new Worker<ProviderDiscoveryJobData>(
      PROVIDER_DISCOVERY_QUEUE,
      async (job) => {
        processed.push(job.data.connectionId);
        return { ok: true };
      },
      { connection, concurrency: 1 },
    );
    resources.push({ queue, worker });
    const data = {
      workspaceId: "workspace-test",
      connectionId: "connection-test",
      provider: "TEST_PROVIDER",
      requestedAt: new Date().toISOString(),
    };
    await enqueueProviderDiscovery(queue, data);
    await enqueueProviderDiscovery(queue, data);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(processed).toEqual(["connection-test"]);
  });
});

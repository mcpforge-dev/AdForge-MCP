import type { Queue } from "bullmq";

export const PROVIDER_DISCOVERY_QUEUE = "holymedia-v2-provider-discovery";

export type ProviderDiscoveryJobData = {
  workspaceId: string;
  connectionId: string;
  provider: string;
  requestedAt: string;
};

export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export async function enqueueProviderDiscovery(
  queue: Queue<ProviderDiscoveryJobData>,
  data: ProviderDiscoveryJobData,
) {
  return queue.add("provider.accounts.discover", data, {
    jobId: `provider-discovery:${data.connectionId}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 250 },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
}

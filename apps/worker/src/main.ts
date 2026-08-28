import { Queue, Worker, type Job } from "bullmq";
import { loadConfig } from "@holymedia/config";
import { closeDatabase, createDatabase } from "@holymedia/database";
import { createLogger } from "@holymedia/observability";
import {
  PROVIDER_DISCOVERY_QUEUE,
  redisConnection,
  type ProviderDiscoveryJobData,
} from "./provider-discovery.job.js";
import {
  processSiteAudit,
  SITE_AUDIT_QUEUE,
  type SiteAuditJobData,
} from "./site-audit.job.js";

const queueName = "holymedia-v2-foundation";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger("holymedia-mcp-v2-worker", config.logLevel);
  const connection = redisConnection(config.redisUrl);
  const database = createDatabase(config.databaseUrl);
  const queue = new Queue(queueName, { connection });
  const worker = new Worker(
    queueName,
    async (job: Job<{ emittedAt: string }>) => {
      logger.info(
        { jobId: job.id, jobName: job.name },
        "foundation job processed",
      );
      return {
        processedAt: new Date().toISOString(),
        emittedAt: job.data.emittedAt,
      };
    },
    { connection, concurrency: 2 },
  );
  const discoveryWorker = new Worker<ProviderDiscoveryJobData>(
    PROVIDER_DISCOVERY_QUEUE,
    async (job) => {
      logger.info(
        {
          jobId: job.id,
          workspaceId: job.data.workspaceId,
          connectionId: job.data.connectionId,
          provider: job.data.provider,
        },
        "provider discovery job processed",
      );
      return { processedAt: new Date().toISOString() };
    },
    { connection, concurrency: 2 },
  );
  const siteAuditWorker = new Worker<SiteAuditJobData>(
    SITE_AUDIT_QUEUE,
    (job) => processSiteAudit(database, job),
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, jobName: job?.name, errorType: error.constructor.name },
      "foundation job failed",
    );
  });
  worker.on("error", (error) => {
    logger.error(
      { errorType: error.constructor.name },
      "worker transport failed",
    );
  });
  await queue.add(
    "foundation.ping",
    { emittedAt: new Date().toISOString() },
    { removeOnComplete: 10, removeOnFail: 10 },
  );
  logger.info(
    { queue: queueName, environment: config.environment },
    "worker started",
  );

  const close = async () => {
    await worker.close();
    await discoveryWorker.close();
    await siteAuditWorker.close();
    await queue.close();
    await closeDatabase(database);
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
}

void bootstrap().catch((error: unknown) => {
  const logger = createLogger("holymedia-mcp-v2-worker");
  logger.fatal(
    { errorType: error instanceof Error ? error.constructor.name : "unknown" },
    "worker failed to start",
  );
  process.exitCode = 1;
});

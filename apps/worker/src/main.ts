import { Queue, Worker, type Job } from "bullmq";
import { loadConfig } from "@holymedia/config";
import { createLogger } from "@holymedia/observability";

const queueName = "holymedia-v2-foundation";

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

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger("holymedia-mcp-v2-worker", config.logLevel);
  const connection = redisConnection(config.redisUrl);
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
    await queue.close();
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

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ReadinessResponse, ServiceStatus } from "@holymedia/contracts";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { checkDatabase } from "@holymedia/database";
import { createLogger, type Logger } from "@holymedia/observability";
import { Redis } from "ioredis";
import { DatabaseService } from "./infrastructure/database.service.js";

@Injectable()
export class ReadinessService {
  private readonly config: AppConfig;
  private readonly redis: Redis;
  private readonly logger: Logger;

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.config = loadConfig();
    this.redis = new Redis(this.config.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    this.logger = createLogger("holymedia-mcp-v2-api", this.config.logLevel);
  }

  public async check(): Promise<ReadinessResponse> {
    const dependencies: ReadinessResponse["dependencies"] = {};
    let overall: ServiceStatus = "ok";

    try {
      dependencies.postgres = {
        status: "ok",
        latencyMs: await checkDatabase(this.database.handle),
      };
    } catch (error) {
      dependencies.postgres = { status: "not_ready" };
      overall = "not_ready";
      this.logger.warn(
        {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
        "postgres readiness failed",
      );
    }

    try {
      const started = performance.now();
      await this.redis.ping();
      dependencies.redis = {
        status: "ok",
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      dependencies.redis = { status: "not_ready" };
      overall = "not_ready";
      this.logger.warn(
        {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
        "redis readiness failed",
      );
    }

    const response: ReadinessResponse = {
      status: overall,
      service: "holymedia-mcp-v2-api",
      version: "foundation-1",
      dependencies,
    };
    if (overall !== "ok") {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }

  public async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

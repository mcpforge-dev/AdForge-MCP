import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Queue, QueueEvents } from "bullmq";
import { loadConfig } from "@holymedia/config";
import { createLogger } from "@holymedia/observability";
import { AuditService } from "../audit/audit.service.js";
import type { RequestWithAuth } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisRateLimitService } from "../infrastructure/redis-rate-limit.service.js";
import { hashIp } from "../infrastructure/security.utils.js";
import type { CreateSupportRequestDto } from "./support-request.dto.js";

export const SUPPORT_TELEGRAM_QUEUE = "holymedia-v2-support-telegram";
export const SUPPORT_TELEGRAM_JOB = "support.telegram.notify";

type DeliveryStatus = "PENDING" | "NOT_CONFIGURED" | "FAILED";

@Injectable()
export class SupportRequestService {
  private readonly config = loadConfig();
  private readonly logger = createLogger("holymedia-mcp-v2-support");

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisRateLimitService)
    private readonly limits: RedisRateLimitService,
  ) {}

  public async create(
    workspaceId: string,
    input: CreateSupportRequestDto,
    request: RequestWithAuth,
  ): Promise<unknown> {
    const userId = request.user?.userId;
    if (!userId)
      throw new ForbiddenException("Authenticated user is required.");
    const message = normalizeMessage(input.message);
    if (message.length < 3)
      throw new BadRequestException("Message is too short.");

    if (input.idempotencyKey) {
      const existing = await this.database.client.supportRequest.findFirst({
        where: { workspaceId, userId, idempotencyKey: input.idempotencyKey },
        select: {
          id: true,
          status: true,
          createdAt: true,
          telegramDeliveryStatus: true,
        },
      });
      if (existing) {
        if (existing.telegramDeliveryStatus !== "SENT")
          await this.enqueueAndConfirm(existing.id, workspaceId);
        return { request: existing, created: false };
      }
    }

    await this.consumeRateLimit(workspaceId, userId, request.ip);
    const workspace = await this.database.client.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        accessStatus: true,
        subscriptions: {
          where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { plan: { select: { key: true } } },
        },
      },
    });
    if (!workspace) throw new ForbiddenException("Workspace access denied.");

    const deliveryStatus: DeliveryStatus = this.telegramConfigured()
      ? "PENDING"
      : "NOT_CONFIGURED";
    const created = await this.database.client.supportRequest.create({
      data: {
        workspaceId,
        userId,
        category: input.category,
        message,
        sourceRoute: input.sourceRoute ?? null,
        locale: input.locale ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        telegramDeliveryStatus: deliveryStatus,
        planKey: workspace.subscriptions[0]?.plan.key ?? null,
        companyAccessStatus: workspace.accessStatus ?? null,
      },
      select: { id: true, status: true, createdAt: true },
    });
    await this.audit.record({
      eventType: "support_request_created",
      actorUserId: userId,
      workspaceId,
      targetType: "support_request",
      targetId: created.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: {
        category: input.category,
        sourceRoute: input.sourceRoute ?? null,
      },
    });

    if (deliveryStatus === "PENDING")
      await this.enqueueAndConfirm(created.id, workspaceId);
    else
      throw new ServiceUnavailableException(
        "Support notification is not configured.",
      );
    return { request: created, created: true };
  }

  private async consumeRateLimit(
    workspaceId: string,
    userId: string,
    ip: string | undefined,
  ): Promise<void> {
    const ipHash = hashIp(ip, this.config.sessionHashSecret);
    await this.limits.consume(`support:user:${userId}`, 8, 600);
    await this.limits.consume(`support:workspace:${workspaceId}`, 20, 3600);
    if (ipHash) await this.limits.consume(`support:ip:${ipHash}`, 30, 3600);
  }

  private async enqueueAndConfirm(
    id: string,
    workspaceId: string,
  ): Promise<void> {
    const queue = new Queue(SUPPORT_TELEGRAM_QUEUE, {
      connection: redisConnection(this.config.redisUrl),
    });
    const events = new QueueEvents(SUPPORT_TELEGRAM_QUEUE, {
      connection: redisConnection(this.config.redisUrl),
    });
    try {
      await events.waitUntilReady();
      const job = await queue.add(
        SUPPORT_TELEGRAM_JOB,
        { supportRequestId: id, workspaceId },
        {
          jobId: `support-telegram-${id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 100,
          // A later user retry must create a fresh delivery attempt.
          removeOnFail: true,
        },
      );
      const result = await job.waitUntilFinished(events, 45_000);
      if (!isDelivered(result))
        throw new Error("Telegram delivery unconfirmed.");
    } catch (error) {
      await this.database.client.supportRequest.update({
        where: { id },
        data: {
          telegramDeliveryStatus: "FAILED",
          telegramLastErrorCode: "DELIVERY_UNCONFIRMED",
        },
      });
      this.logger.error(
        {
          supportRequestId: id,
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
        "support Telegram delivery was not confirmed",
      );
      throw new ServiceUnavailableException("Support notification failed.");
    } finally {
      await events.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
    }
  }

  private telegramConfigured(): boolean {
    return Boolean(
      this.config.telegramSupportBotToken && this.config.telegramSupportChatId,
    );
  }
}

function isDelivered(value: unknown): value is { delivered: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "delivered" in value &&
    value.delivered === true
  );
}

function normalizeMessage(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

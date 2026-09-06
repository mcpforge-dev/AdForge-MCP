import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
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
type TelegramDeliveryConfirmation = {
  delivered: true;
  telegramMessageId: string;
};

export class SupportDeliveryPending extends Error {}

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
    const sourceRoute = normalizeSourceRoute(
      input.sourceRoute,
      this.config.publicBaseUrl,
    );
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
          telegramMessageId: true,
          category: true,
          message: true,
          sourceRoute: true,
          locale: true,
        },
      });
      if (existing) {
        assertSamePayload(existing, {
          category: input.category,
          message,
          sourceRoute,
          locale: input.locale ?? null,
        });
        const delivery = existing.telegramMessageId
          ? {
              delivered: true as const,
              telegramMessageId: existing.telegramMessageId,
            }
          : await this.enqueueAndConfirm(existing.id, workspaceId);
        return {
          request: {
            ...existing,
            telegramDeliveryStatus: "SENT",
            telegramMessageId: delivery.telegramMessageId,
          },
          created: false,
          telegramDelivered: true,
          telegramMessageId: delivery.telegramMessageId,
        };
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
    let newlyCreated = true;
    const created = await this.database.client.supportRequest
      .create({
        data: {
          workspaceId,
          userId,
          category: input.category,
          message,
          sourceRoute,
          locale: input.locale ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          telegramDeliveryStatus: deliveryStatus,
          planKey: workspace.subscriptions[0]?.plan.key ?? null,
          companyAccessStatus: workspace.accessStatus ?? null,
        },
        select: { id: true, status: true, createdAt: true },
      })
      .catch(async (error: unknown) => {
        // Handle only the key constraint race, never unrelated Prisma failures.
        if (!input.idempotencyKey || !isIdempotencyConflict(error)) throw error;
        const winner = await this.database.client.supportRequest.findFirst({
          where: { workspaceId, userId, idempotencyKey: input.idempotencyKey },
        });
        if (!winner) throw error;
        assertSamePayload(winner, {
          category: input.category,
          message,
          sourceRoute,
          locale: input.locale ?? null,
        });
        newlyCreated = false;
        return {
          id: winner.id,
          status: winner.status,
          createdAt: winner.createdAt,
        };
      });
    if (newlyCreated)
      await this.audit
        .record({
          eventType: "support_request_created",
          actorUserId: userId,
          workspaceId,
          targetType: "support_request",
          targetId: created.id,
          ...(request.requestId ? { requestId: request.requestId } : {}),
          metadata: {
            category: input.category,
            sourceRoute,
          },
        })
        .catch(() =>
          this.logger.error(
            { supportRequestId: created.id },
            "support creation audit insert failed",
          ),
        );

    const delivery =
      deliveryStatus === "PENDING"
        ? await this.enqueueAndConfirm(created.id, workspaceId)
        : null;
    if (!delivery)
      throw new ServiceUnavailableException(
        "Support notification is not configured.",
      );
    return {
      request: {
        ...created,
        telegramDeliveryStatus: "SENT",
        telegramMessageId: delivery.telegramMessageId,
      },
      created: newlyCreated,
      telegramDelivered: true,
      telegramMessageId: delivery.telegramMessageId,
    };
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
  ): Promise<TelegramDeliveryConfirmation> {
    const readConfirmation = async () => {
      const row = await this.database.client.supportRequest.findFirst({
        where: { id, workspaceId },
        select: { telegramMessageId: true, telegramDeliveryStatus: true },
      });
      return row;
    };
    const before = await readConfirmation();
    if (before?.telegramMessageId)
      return { delivered: true, telegramMessageId: before.telegramMessageId };
    if (before?.telegramDeliveryStatus === "UNCERTAIN")
      throw new SupportDeliveryPending();
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
      return result;
    } catch (error) {
      // A wait failure is not a delivery failure. Only the sender owns state
      // transitions; re-read after timeout to observe a concurrent success.
      const current = await readConfirmation();
      if (current?.telegramMessageId)
        return {
          delivered: true,
          telegramMessageId: current.telegramMessageId,
        };
      this.logger.error(
        {
          supportRequestId: id,
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
        "support Telegram delivery was not confirmed",
      );
      if (current?.telegramDeliveryStatus === "FAILED")
        throw new ServiceUnavailableException("Support notification failed.");
      throw new SupportDeliveryPending();
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

type SupportPayload = {
  category: string;
  message: string;
  sourceRoute: string | null;
  locale: string | null;
};

function fingerprint(payload: SupportPayload): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        payload.category,
        normalizeMessage(payload.message),
        payload.sourceRoute,
        payload.locale,
      ]),
    )
    .digest("hex");
}

function assertSamePayload(
  stored: SupportPayload,
  requested: SupportPayload,
): void {
  // workspace/user are bound by the lookup and database unique constraint.
  // Hash persisted fields instead of inventing fingerprints for old rows.
  if (fingerprint(stored) !== fingerprint(requested))
    throw new ConflictException(
      "This request key belongs to a different message. Submit the edited message as a new request.",
    );
}

function isIdempotencyConflict(error: unknown): boolean {
  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error) ||
    error.code !== "P2002"
  )
    return false;
  const meta = "meta" in error ? error.meta : null;
  if (!meta || typeof meta !== "object" || !("target" in meta)) return false;
  const target = JSON.stringify(meta.target);
  return (
    /workspace_?id/i.test(target) &&
    /user_?id/i.test(target) &&
    /idempotency_?key/i.test(target)
  );
}

function isDelivered(value: unknown): value is TelegramDeliveryConfirmation {
  return (
    typeof value === "object" &&
    value !== null &&
    "delivered" in value &&
    value.delivered === true &&
    "telegramMessageId" in value &&
    typeof value.telegramMessageId === "string" &&
    value.telegramMessageId.length > 0
  );
}

function normalizeMessage(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function normalizeSourceRoute(
  value: string | undefined,
  publicBaseUrl: string,
): string | null {
  if (!value) return null;
  try {
    const origin = new URL(publicBaseUrl).origin;
    const url = new URL(value, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/dashboard"))
      return null;
    return `${origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
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

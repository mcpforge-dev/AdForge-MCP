import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@holymedia/database";
import { DatabaseService } from "../infrastructure/database.service.js";

const SAFE_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
const SENSITIVE_KEY =
  /token|secret|password|cookie|authorization|credential|session|email|phone|customer_id|account_id/i;

export type ProductEventInput = {
  workspaceId: string;
  userId?: string;
  eventName: string;
  requestId?: string;
  properties?: Record<string, unknown>;
};

@Injectable()
export class ProductAnalyticsService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public async record(input: ProductEventInput): Promise<void> {
    const properties = sanitizeProperties(input.properties);
    await this.database.client.productEvent.create({
      data: {
        workspaceId: input.workspaceId,
        eventName: input.eventName,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(properties ? { properties } : {}),
      },
    });
  }

  public async summary(workspaceId: string, days = 30) {
    const boundedDays = Math.min(Math.max(Math.trunc(days), 1), 90);
    const since = new Date(Date.now() - boundedDays * 86_400_000);
    const [events, activeUsers] = await Promise.all([
      this.database.client.productEvent.groupBy({
        by: ["eventName"],
        where: { workspaceId, occurredAt: { gte: since } },
        _count: { _all: true },
        orderBy: { eventName: "asc" },
      }),
      this.database.client.productEvent.findMany({
        where: {
          workspaceId,
          occurredAt: { gte: since },
          userId: { not: null },
        },
        distinct: ["userId"],
        select: { userId: true },
      }),
    ]);
    return {
      period: { days: boundedDays, since: since.toISOString() },
      total_events: events.reduce((sum, row) => sum + row._count._all, 0),
      active_users: activeUsers.length,
      events: events.map((row) => ({
        name: row.eventName,
        count: row._count._all,
      })),
    };
  }
}

export function sanitizeProperties(
  input?: Record<string, unknown>,
): Prisma.InputJsonObject | undefined {
  if (!input) return undefined;
  const entries = Object.entries(input);
  if (entries.length > 20)
    throw new BadRequestException("Too many analytics properties.");
  const safe: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of entries) {
    if (!SAFE_KEY.test(key) || SENSITIVE_KEY.test(key))
      throw new BadRequestException("Unsafe analytics property.");
    if (typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new BadRequestException("Invalid analytics property.");
      safe[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= 160) {
      safe[key] = value;
      continue;
    }
    throw new BadRequestException("Unsupported analytics property.");
  }
  return Object.keys(safe).length ? (safe as Prisma.InputJsonObject) : undefined;
}

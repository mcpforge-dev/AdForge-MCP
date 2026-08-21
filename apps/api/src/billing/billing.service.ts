import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../infrastructure/database.service.js";

@Injectable()
export class BillingService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public listPlans(): Promise<unknown> {
    return this.database.client.plan.findMany({
      where: { active: true },
      include: {
        prices: { where: { active: true }, orderBy: { amount: "asc" } },
      },
      orderBy: { key: "asc" },
    });
  }

  public currentSubscription(workspaceId: string): Promise<unknown> {
    return this.database.client.workspaceSubscription.findFirst({
      where: {
        workspaceId,
        status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
      },
      include: { plan: true, price: true },
      orderBy: { createdAt: "desc" },
    });
  }

  public usage(workspaceId: string): Promise<unknown> {
    return this.database.client.usageRecord.findMany({
      where: { workspaceId },
      orderBy: { periodEnd: "desc" },
      take: 100,
    });
  }

  public entitlements(workspaceId: string): Promise<unknown> {
    return this.database.client.entitlement.findMany({
      where: {
        workspaceId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { featureKey: "asc" },
    });
  }

  public async recordUsage(
    workspaceId: string,
    metricKey: string,
    quantity = 1,
  ): Promise<void> {
    if (
      !/^[a-z][a-z0-9_.-]{1,119}$/.test(metricKey) ||
      /token|secret|password|authorization|cookie/i.test(metricKey)
    )
      return;
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    await this.database.client.usageRecord.upsert({
      where: {
        workspaceId_metricKey_periodStart_periodEnd: {
          workspaceId,
          metricKey,
          periodStart,
          periodEnd,
        },
      },
      create: {
        workspaceId,
        metricKey,
        periodStart,
        periodEnd,
        quantity,
      },
      update: { quantity: { increment: quantity } },
    });
  }
}

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
}

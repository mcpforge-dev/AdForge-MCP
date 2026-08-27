import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
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
      where: { workspaceId },
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

  public async requireFeature(
    workspaceId: string,
    featureKey: string,
  ): Promise<void> {
    const value = await this.featureValue(workspaceId, featureKey);
    if (value !== true)
      throw new ForbiddenException(
        "Feature is not available for this workspace.",
      );
  }

  public async consumeMcpRequest(workspaceId: string): Promise<void> {
    await this.requireFeature(workspaceId, "mcp");
    const limit = await this.numericLimit(workspaceId, "monthly_mcp_requests");
    if (limit === null) {
      await this.recordUsage(workspaceId, "mcp.requests");
      return;
    }
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    await this.database.client.$transaction(
      async (transaction) => {
        const usage = await transaction.usageRecord.upsert({
          where: {
            workspaceId_metricKey_periodStart_periodEnd: {
              workspaceId,
              metricKey: "mcp.requests",
              periodStart,
              periodEnd,
            },
          },
          create: {
            workspaceId,
            metricKey: "mcp.requests",
            periodStart,
            periodEnd,
            quantity: 1,
          },
          update: { quantity: { increment: 1 } },
          select: { quantity: true },
        });
        if (Number(usage.quantity) > limit)
          throw new HttpException(
            "Workspace usage limit reached.",
            HttpStatus.TOO_MANY_REQUESTS,
          );
      },
      { isolationLevel: "Serializable" },
    );
  }

  public async setProviderAccountEnabled(
    workspaceId: string,
    accountId: string,
    enabled: boolean,
  ): Promise<boolean> {
    if (!enabled) {
      const result = await this.database.client.providerAccount.updateMany({
        where: { id: accountId, workspaceId },
        data: { enabled: false },
      });
      return result.count === 1;
    }
    const limit = await this.numericLimit(workspaceId, "provider_accounts");
    return this.database.client.$transaction(
      async (transaction) => {
        const account = await transaction.providerAccount.findFirst({
          where: { id: accountId, workspaceId },
          select: { enabled: true },
        });
        if (!account) return false;
        if (account.enabled) return true;
        if (limit !== null) {
          const count = await transaction.providerAccount.count({
            where: { workspaceId, enabled: true },
          });
          if (count >= limit)
            throw new ForbiddenException("Provider account limit reached.");
        }
        const result = await transaction.providerAccount.updateMany({
          where: { id: accountId, workspaceId, enabled: false },
          data: { enabled: true },
        });
        return result.count === 1;
      },
      { isolationLevel: "Serializable" },
    );
  }

  public async setProviderAccountsEnabled(
    workspaceId: string,
    connectionId: string,
    accountIds: string[],
  ): Promise<{ changedAccountIds: string[] }> {
    const selectedIds = [...new Set(accountIds)];
    const limit = await this.numericLimit(workspaceId, "provider_accounts");

    return this.database.client.$transaction(
      async (transaction) => {
        const accounts = await transaction.providerAccount.findMany({
          where: { workspaceId, connectionId },
          select: { id: true, enabled: true },
        });
        const accountIdsInConnection = new Set(
          accounts.map((account) => account.id),
        );
        if (
          selectedIds.some(
            (accountId) => !accountIdsInConnection.has(accountId),
          )
        )
          throw new ForbiddenException(
            "Provider account selection is invalid.",
          );

        const selected = new Set(selectedIds);
        const changedAccountIds = accounts
          .filter((account) => account.enabled !== selected.has(account.id))
          .map((account) => account.id);
        const enabledOutsideConnection =
          await transaction.providerAccount.count({
            where: {
              workspaceId,
              connectionId: { not: connectionId },
              enabled: true,
            },
          });
        if (
          limit !== null &&
          enabledOutsideConnection + selectedIds.length > limit
        )
          throw new ForbiddenException("Provider account limit reached.");

        await transaction.providerAccount.updateMany({
          where: { workspaceId, connectionId, enabled: true },
          data: { enabled: false },
        });
        if (selectedIds.length) {
          await transaction.providerAccount.updateMany({
            where: {
              workspaceId,
              connectionId,
              id: { in: selectedIds },
            },
            data: { enabled: true },
          });
        }
        return { changedAccountIds };
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async numericLimit(
    workspaceId: string,
    featureKey: string,
  ): Promise<number | null> {
    const value = await this.featureValue(workspaceId, featureKey);
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new ForbiddenException("Workspace limit is not configured.");
    return Math.trunc(value);
  }

  private async featureValue(
    workspaceId: string,
    featureKey: string,
  ): Promise<unknown> {
    const [entitlements, subscription, expiredTrial] = await Promise.all([
      this.database.client.entitlement.findMany({
        where: {
          workspaceId,
          featureKey: { in: [featureKey, "legacy_access"] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { featureKey: true, value: true },
      }),
      this.database.client.workspaceSubscription.findFirst({
        where: {
          workspaceId,
          OR: [
            { status: { in: ["ACTIVE", "PAST_DUE"] } },
            { status: "TRIALING", trialEndsAt: { gt: new Date() } },
          ],
        },
        include: { plan: { select: { features: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.database.client.workspaceSubscription.findFirst({
        where: {
          workspaceId,
          status: "TRIALING",
          trialEndsAt: { lte: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    ]);
    const legacy = entitlements.find(
      (item) => item.featureKey === "legacy_access",
    );
    if (legacy?.value === true) {
      return featureKey.includes("requests") || featureKey.includes("accounts")
        ? null
        : true;
    }
    const override = entitlements.find(
      (item) => item.featureKey === featureKey,
    );
    if (override) return override.value;
    if (!subscription && expiredTrial)
      return featureKey.includes("requests") || featureKey.includes("accounts")
        ? 0
        : false;
    const plan =
      subscription?.plan ??
      (await this.database.client.plan.findUnique({
        where: { key: "free" },
        select: { features: true },
      }));
    const features = plan?.features;
    if (!features || typeof features !== "object" || Array.isArray(features))
      return undefined;
    return (features as Record<string, unknown>)[featureKey];
  }
}

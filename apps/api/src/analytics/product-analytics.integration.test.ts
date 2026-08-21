import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ProductAnalyticsService } from "./product-analytics.service.js";

const integrationEnabled =
  process.env.V2_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL);

describe.skipIf(!integrationEnabled)("product analytics integration", () => {
  const database = new DatabaseService();
  const analytics = new ProductAnalyticsService(database);
  const suffix = randomUUID();
  const email = `analytics-${suffix}@example.test`;
  let userId = "";
  let workspaceA = "";
  let workspaceB = "";

  beforeAll(async () => {
    const user = await database.client.user.create({
      data: {
        email,
        name: "Analytics Test",
        passwordHash: "not-a-real-login-hash",
      },
    });
    userId = user.id;
    const [a, b] = await Promise.all([
      database.client.workspace.create({
        data: { name: "Analytics A", slug: `analytics-a-${suffix}` },
      }),
      database.client.workspace.create({
        data: { name: "Analytics B", slug: `analytics-b-${suffix}` },
      }),
    ]);
    workspaceA = a.id;
    workspaceB = b.id;
  });

  afterAll(async () => {
    await database.client.workspace.deleteMany({
      where: { id: { in: [workspaceA, workspaceB].filter(Boolean) } },
    });
    await database.client.user.deleteMany({ where: { email } });
    await database.onModuleDestroy();
  });

  it("aggregates only the requested workspace", async () => {
    await analytics.record({
      workspaceId: workspaceA,
      userId,
      eventName: "onboarding.started",
      properties: { source: "dashboard" },
    });
    await analytics.record({
      workspaceId: workspaceB,
      userId,
      eventName: "checkout.started",
    });

    const summary = await analytics.summary(workspaceA);
    expect(summary.total_events).toBe(1);
    expect(summary.active_users).toBe(1);
    expect(summary.events).toEqual([{ name: "onboarding.started", count: 1 }]);
  });
});

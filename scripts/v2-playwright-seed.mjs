import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { createDatabase } from "../packages/database/dist/index.js";

const database = createDatabase(
  process.env.DATABASE_URL ??
    "postgresql://holymedia:local-only-password@127.0.0.1:5433/holymedia_v2",
);
const email = process.env.V2_E2E_EMAIL ?? "phase-b-legacy-user@example.test";
const password = process.env.V2_E2E_PASSWORD ?? "Phase-B-legacy-password-123!";
const salt = randomBytes(16);
const digest = pbkdf2Sync(password, salt, 240_000, 32, "sha256");
const legacyHash = `pbkdf2_sha256$240000$${salt.toString("base64")}$${digest.toString("base64")}`;

try {
  const existing = await database.client.user.findUnique({ where: { email } });
  let userId;
  let workspaceId;
  if (existing) {
    const membership = await database.client.workspaceMembership.findFirst({
      where: { userId: existing.id },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) throw new Error("Browser fixture has no workspace.");
    userId = existing.id;
    workspaceId = membership.workspaceId;
    await database.client.user.update({
      where: { id: existing.id },
      data: { passwordHash: legacyHash, status: "active" },
    });
    console.log(JSON.stringify({ seeded: true, mode: "reset-existing" }));
  } else {
    userId = randomUUID();
    workspaceId = randomUUID();
    await database.client.$transaction([
      database.client.user.create({
        data: {
          id: userId,
          email,
          name: "Phase B legacy user",
          passwordHash: legacyHash,
          emailVerifiedAt: new Date(),
        },
      }),
      database.client.workspace.create({
        data: {
          id: workspaceId,
          name: "Phase B legacy workspace",
          slug: `phase-b-legacy-${randomUUID().slice(0, 8)}`,
        },
      }),
      database.client.workspaceMembership.create({
        data: { userId, workspaceId, role: "OWNER" },
      }),
    ]);
    console.log(JSON.stringify({ seeded: true, mode: "created" }));
  }

  const connection = await database.client.providerConnection.upsert({
    where: {
      workspaceId_provider: { workspaceId, provider: "META_ADS" },
    },
    create: {
      workspaceId,
      provider: "META_ADS",
      status: "CONNECTED",
      displayName: "Playwright Meta",
      externalSubjectId: "playwright-meta-user",
      createdBy: userId,
      connectedAt: new Date(),
      lastSuccessAt: new Date(),
    },
    update: {
      status: "CONNECTED",
      displayName: "Playwright Meta",
      lastSuccessAt: new Date(),
    },
  });
  for (const [externalAccountId, displayName, enabled] of [
    ["act_playwright_primary", "Основной рекламный кабинет", true],
    ["act_playwright_secondary", "Тестовый рекламный кабинет", false],
  ]) {
    await database.client.providerAccount.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: "META_ADS",
          externalAccountId,
        },
      },
      create: {
        workspaceId,
        connectionId: connection.id,
        provider: "META_ADS",
        externalAccountId,
        displayName,
        enabled,
        status: "ENABLED",
      },
      update: { connectionId: connection.id, displayName, status: "ENABLED" },
    });
  }

  await database.client.entitlement.upsert({
    where: {
      workspaceId_featureKey: {
        workspaceId,
        featureKey: "legacy_access",
      },
    },
    create: {
      workspaceId,
      featureKey: "legacy_access",
      value: true,
      source: "legacy_internal",
    },
    update: {
      value: true,
      source: "legacy_internal",
      expiresAt: null,
    },
  });
} finally {
  await database.client.$disconnect();
  await database.pool.end();
}

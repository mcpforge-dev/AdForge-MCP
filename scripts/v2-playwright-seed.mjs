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
  if (existing) {
    await database.client.user.update({
      where: { id: existing.id },
      data: { passwordHash: legacyHash, status: "active" },
    });
    console.log(JSON.stringify({ seeded: true, mode: "reset-existing" }));
  } else {
    const userId = randomUUID();
    const workspaceId = randomUUID();
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
} finally {
  await database.client.$disconnect();
  await database.pool.end();
}

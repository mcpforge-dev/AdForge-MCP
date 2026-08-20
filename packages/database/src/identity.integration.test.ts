import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase, type DatabaseHandle } from "./index.js";

const enabled = process.env.V2_INTEGRATION_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("identity PostgreSQL integration", () => {
  let database: DatabaseHandle;
  const userA = randomUUID();
  const userB = randomUUID();
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();

  beforeAll(async () => {
    database = createDatabase(process.env.DATABASE_URL!);
    await database.client.user.createMany({
      data: [
        { id: userA, email: `${userA}@example.test`, name: "User A", passwordHash: "argon2-test" },
        { id: userB, email: `${userB}@example.test`, name: "User B", passwordHash: "argon2-test" },
      ],
    });
    await database.client.workspace.createMany({
      data: [
        { id: workspaceA, name: "Workspace A", slug: `integration-a-${userA.slice(0, 8)}` },
        { id: workspaceB, name: "Workspace B", slug: `integration-b-${userB.slice(0, 8)}` },
      ],
    });
    await database.client.workspaceMembership.createMany({
      data: [
        { userId: userA, workspaceId: workspaceA, role: "OWNER" },
        { userId: userB, workspaceId: workspaceB, role: "OWNER" },
      ],
    });
  });

  afterAll(async () => {
    await database.client.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB] } } });
    await database.client.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await closeDatabase(database);
  });

  it("keeps workspace membership tenant-scoped", async () => {
    const userAMembershipInB = await database.client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspaceB, userId: userA } },
    });
    expect(userAMembershipInB).toBeNull();
    const userBMembership = await database.client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspaceB, userId: userB } },
    });
    expect(userBMembership?.role).toBe("OWNER");
  });

  it("enforces the unique membership invariant in PostgreSQL", async () => {
    await expect(
      database.client.workspaceMembership.create({ data: { userId: userA, workspaceId: workspaceA, role: "MEMBER" } }),
    ).rejects.toThrow();
  });

  it("keeps at least one owner at the database boundary", async () => {
    const membership = await database.client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspaceA, userId: userA } },
    });
    await expect(
      database.client.workspaceMembership.update({
        where: { id: membership!.id },
        data: { role: "MEMBER" },
      }),
    ).rejects.toThrow(/workspace must retain an owner/i);
    await expect(
      database.client.workspaceMembership.delete({ where: { id: membership!.id } }),
    ).rejects.toThrow(/workspace must retain an owner/i);
  });
});

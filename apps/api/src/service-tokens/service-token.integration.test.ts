import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ServiceTokenService } from "./service-token.service.js";

const integrationEnabled =
  process.env.V2_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL);

describe.skipIf(!integrationEnabled)(
  "service token lifecycle integration",
  () => {
    const database = new DatabaseService();
    const audit = new AuditService(database);
    const serviceTokens = new ServiceTokenService(database, audit);
    const suffix = randomUUID();
    const email = `service-token-${suffix}@example.test`;
    const request: RequestWithAuth = {
      requestId: `service-token-${suffix}`,
      headers: { "user-agent": "v2-integration" },
      ip: "127.0.0.1",
    };
    let userId = "";
    let workspaceId = "";
    let principal: HumanPrincipal;

    beforeAll(async () => {
      const user = await database.client.user.create({
        data: {
          email,
          name: "Service token integration",
          passwordHash: "test",
        },
      });
      const workspace = await database.client.workspace.create({
        data: {
          name: "Service token integration",
          slug: `service-token-${suffix}`,
          memberships: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      userId = user.id;
      workspaceId = workspace.id;
      principal = { kind: "human", userId, sessionId: randomUUID() };
    });

    afterAll(async () => {
      if (workspaceId)
        await database.client.workspace.delete({ where: { id: workspaceId } });
      await database.client.user.deleteMany({ where: { id: userId } });
      await database.onModuleDestroy();
    });

    it("rotates atomically and revokes the previous token", async () => {
      const created = await serviceTokens.create(
        workspaceId,
        { name: "Integration token", scopes: ["adforge:mcp:read"] },
        principal,
        request,
      );
      expect((await serviceTokens.authenticate(created.token))?.tokenId).toBe(
        created.id,
      );

      const rotated = await serviceTokens.rotate(
        workspaceId,
        created.id,
        { expiresInDays: 30 },
        principal,
        request,
      );
      expect(rotated.token).not.toBe(created.token);
      expect(await serviceTokens.authenticate(created.token)).toBeNull();
      expect((await serviceTokens.authenticate(rotated.token))?.tokenId).toBe(
        rotated.id,
      );
      const stored = await database.client.serviceToken.findUniqueOrThrow({
        where: { id: rotated.id },
      });
      expect(stored.tokenDigest).not.toContain(rotated.token);
    });
  },
);

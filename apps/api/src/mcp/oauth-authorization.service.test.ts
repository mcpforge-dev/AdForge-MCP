import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { McpController } from "./mcp.controller.js";
import {
  MCP_RESOURCE,
  OAuthAuthorizationService,
} from "./oauth-authorization.service.js";

type Row = Record<string, unknown> & { id: string };

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function whereMatches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const condition = expected as Record<string, unknown>;
      if ("gt" in condition)
        return actual instanceof Date && actual > condition.gt!;
      if ("not" in condition) return actual !== condition.not;
      return true;
    }
    return actual === expected;
  });
}

function fakeDatabase() {
  const publicClients: Row[] = [];
  const transactions: Row[] = [];
  const codes: Row[] = [];
  const accessTokens: Row[] = [];
  const memberships: Row[] = [];
  const workspaces = new Map<
    string,
    { id: string; name: string; accessStatus: string }
  >();
  const users = new Map<string, { id: string; status: string }>();

  const client = {
    oAuthPublicClient: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          revokedAt: null,
          status: "active",
          ...data,
        };
        publicClients.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        publicClients.find((row) => whereMatches(row, where)) ?? null,
    },
    oAuthAuthorizationTransaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          consumedAt: null,
          ...data,
        };
        transactions.push(row);
        return row;
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: Record<string, unknown>;
        include?: unknown;
      }) => {
        const row = transactions.find((item) => whereMatches(item, where));
        if (!row || !include) return row ?? null;
        const registered = publicClients.find(
          (item) => item.id === row.clientId,
        )!;
        return {
          ...row,
          client: {
            clientName: registered.clientName,
            clientId: registered.clientId,
          },
        };
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
        include?: unknown;
      }) => {
        const row = transactions.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        if (!include) return row;
        const registered = publicClients.find(
          (item) => item.id === row.clientId,
        )!;
        const workspace = workspaces.get(String(row.workspaceId))!;
        return {
          ...row,
          client: {
            clientName: registered.clientName,
            clientId: registered.clientId,
          },
          workspace: { id: workspace.id, name: workspace.name },
        };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = transactions.filter((row) => whereMatches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    oAuthAuthorizationCode: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          usedAt: null,
          ...data,
        };
        codes.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        codes.find((row) => whereMatches(row, where)) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = codes.filter((row) => whereMatches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    oAuthAccessToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          revokedAt: null,
          lastUsedAt: null,
          ...data,
        };
        accessTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenDigest: string } }) => {
        const row = accessTokens.find(
          (item) => item.tokenDigest === where.tokenDigest,
        );
        if (!row) return null;
        const registered = publicClients.find(
          (item) => item.id === row.clientId,
        )!;
        return {
          ...row,
          client: {
            clientId: registered.clientId,
            status: registered.status,
            revokedAt: registered.revokedAt,
          },
          workspace: {
            accessStatus: workspaces.get(String(row.workspaceId))?.accessStatus,
          },
          user: { status: users.get(String(row.userId))?.status },
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = accessTokens.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = accessTokens.filter((row) => whereMatches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    workspaceMembership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          memberships.find((row) => {
            if (where.userId && row.userId !== where.userId) return false;
            if (where.workspaceId && row.workspaceId !== where.workspaceId)
              return false;
            return (
              workspaces.get(String(row.workspaceId))?.accessStatus === "ACTIVE"
            );
          }) ?? null
        );
      },
      findUnique: async ({
        where,
      }: {
        where: { workspaceId_userId: { workspaceId: string; userId: string } };
      }) =>
        memberships.find(
          (row) =>
            row.workspaceId === where.workspaceId_userId.workspaceId &&
            row.userId === where.workspaceId_userId.userId,
        ) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        memberships
          .filter((row) => {
            if (where.userId && row.userId !== where.userId) return false;
            return (
              workspaces.get(String(row.workspaceId))?.accessStatus === "ACTIVE"
            );
          })
          .map((row) => ({
            role: row.role ?? "OWNER",
            workspace: workspaces.get(String(row.workspaceId)),
          })),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(client),
  };

  return {
    database: { client } as never,
    state: {
      publicClients,
      transactions,
      codes,
      accessTokens,
      memberships,
      workspaces,
      users,
    },
  };
}

function reply() {
  const result = {
    status: 0,
    body: undefined as unknown,
    code(status: number) {
      this.status = status;
      return this;
    },
    header() {
      return this;
    },
    send(body?: unknown) {
      this.body = body;
      return body;
    },
  };
  return result;
}

async function fixture() {
  const { database, state } = fakeDatabase();
  const oauth = new OAuthAuthorizationService(database);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  state.users.set(userId, { id: userId, status: "active" });
  state.workspaces.set(workspaceId, {
    id: workspaceId,
    name: "OAuth workspace",
    accessStatus: "ACTIVE",
  });
  state.memberships.push({
    id: randomUUID(),
    userId,
    workspaceId,
    createdAt: new Date(),
  });
  const registered = await oauth.registerPublicClient({
    client_name: "Claude test",
    redirect_uris: ["https://claude.example.test/callback"],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  const principal: HumanPrincipal = {
    kind: "human",
    userId,
    sessionId: randomUUID(),
  };
  const verifier = "v".repeat(64);
  return { oauth, state, principal, workspaceId, registered, verifier };
}

async function issueCode(context: Awaited<ReturnType<typeof fixture>>) {
  const started = await context.oauth.beginAuthorization({
    client_id: context.registered.client_id,
    redirect_uri: "https://claude.example.test/callback",
    response_type: "code",
    state: "state-123",
    scope: "adforge:mcp:read",
    resource: MCP_RESOURCE,
    code_challenge: pkce(context.verifier),
    code_challenge_method: "S256",
  });
  await context.oauth.continueAuthorization(
    started.transaction_id,
    context.principal,
  );
  const consent = await context.oauth.decideAuthorization(
    started.transaction_id,
    true,
    context.principal,
  );
  return {
    ...started,
    code: new URL(consent.url).searchParams.get("code")!,
  };
}

describe("OAuth authorization foundation", () => {
  it("persists an anonymous transaction and resumes it with the authenticated workspace", async () => {
    const context = await fixture();
    const started = await context.oauth.beginAuthorization({
      client_id: context.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      state: "opaque-state",
      resource: MCP_RESOURCE,
      code_challenge: pkce(context.verifier),
      code_challenge_method: "S256",
    });

    expect(started.url).toContain("/auth?oauth_transaction=");
    const stored = context.state.transactions[0]!;
    expect(stored).toMatchObject({
      state: "opaque-state",
      redirectUri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      userId: null,
      workspaceId: null,
    });

    const resumed = await context.oauth.continueAuthorization(
      started.transaction_id,
      context.principal,
    );
    expect(resumed).toMatchObject({
      url: expect.stringContaining("/connect/claude?transaction="),
      statusCode: 302,
    });
    await expect(
      context.oauth.authorizationContext(
        started.transaction_id,
        context.principal,
      ),
    ).resolves.toMatchObject({
      selectedWorkspaceId: context.workspaceId,
      workspaces: [{ id: context.workspaceId }],
    });
  });

  it("exchanges a one-time code with S256 PKCE and authenticates MCP", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const token = await context.oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    expect(token.access_token).toMatch(/^hm_oauth_/);
    expect(context.state.accessTokens[0]!.tokenDigest).toBe(
      digest(token.access_token),
    );
    expect(await context.oauth.authenticate(token.access_token)).toMatchObject({
      workspaceId: context.workspaceId,
      scopes: ["adforge:mcp:read"],
    });

    const mcp = new McpController(
      { tools: () => [{ name: "list_ad_accounts" }] } as never,
      { authenticate: async () => null } as never,
      context.oauth,
      { consumeMcpRequest: async () => undefined } as never,
      { record: async () => undefined } as never,
    );
    const initializedReply = reply();
    const initialize = await mcp.post(
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      } as never,
      initializedReply as never,
    );
    expect(initialize).toMatchObject({
      result: { protocolVersion: "2025-03-26" },
    });

    const notificationReply = reply();
    await mcp.post(
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      } as never,
      notificationReply as never,
    );
    expect(notificationReply.status).toBe(202);

    const tools = await mcp.post(
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      } as never,
      reply() as never,
    );
    expect(tools).toMatchObject({
      result: { tools: [{ name: "list_ad_accounts" }] },
    });
  });

  it("rejects wrong PKCE, redirect mismatch, expired and reused codes", async () => {
    const wrongPkce = await fixture();
    const first = await issueCode(wrongPkce);
    await expect(
      wrongPkce.oauth.exchangeAuthorizationCode({
        grant_type: "authorization_code",
        client_id: wrongPkce.registered.client_id,
        code: first.code,
        redirect_uri: "https://claude.example.test/callback",
        resource: MCP_RESOURCE,
        code_verifier: "x".repeat(64),
      }),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      wrongPkce.oauth.exchangeAuthorizationCode({
        grant_type: "authorization_code",
        client_id: wrongPkce.registered.client_id,
        code: first.code,
        redirect_uri: "https://claude.example.test/other",
        resource: MCP_RESOURCE,
        code_verifier: wrongPkce.verifier,
      }),
    ).rejects.toMatchObject({ status: 401 });

    wrongPkce.state.codes[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(
      wrongPkce.oauth.exchangeAuthorizationCode({
        grant_type: "authorization_code",
        client_id: wrongPkce.registered.client_id,
        code: first.code,
        redirect_uri: "https://claude.example.test/callback",
        resource: MCP_RESOURCE,
        code_verifier: wrongPkce.verifier,
      }),
    ).rejects.toMatchObject({ status: 401 });

    const reused = await fixture();
    const second = await issueCode(reused);
    const input = {
      grant_type: "authorization_code",
      client_id: reused.registered.client_id,
      code: second.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: reused.verifier,
    };
    await reused.oauth.exchangeAuthorizationCode(input);
    await expect(
      reused.oauth.exchangeAuthorizationCode(input),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects expired transactions and foreign workspace binding", async () => {
    const context = await fixture();
    const started = await context.oauth.beginAuthorization({
      client_id: context.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      resource: MCP_RESOURCE,
      code_challenge: pkce(context.verifier),
      code_challenge_method: "S256",
    });
    context.state.transactions[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(
      context.oauth.continueAuthorization(
        started.transaction_id,
        context.principal,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const foreign = await fixture();
    const issued = await foreign.oauth.beginAuthorization({
      client_id: foreign.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      resource: MCP_RESOURCE,
      code_challenge: pkce(foreign.verifier),
      code_challenge_method: "S256",
    });
    await expect(
      foreign.oauth.continueAuthorization(
        issued.transaction_id,
        foreign.principal,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("requires an explicit company choice for a multi-workspace user and binds the code server-side", async () => {
    const context = await fixture();
    const secondWorkspaceId = randomUUID();
    context.state.workspaces.set(secondWorkspaceId, {
      id: secondWorkspaceId,
      name: "Second workspace",
      accessStatus: "ACTIVE",
    });
    context.state.memberships.push({
      id: randomUUID(),
      userId: context.principal.userId,
      workspaceId: secondWorkspaceId,
      role: "ADMIN",
      createdAt: new Date(),
    });

    const started = await context.oauth.beginAuthorization(
      {
        client_id: context.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        state: "multi-workspace-state",
        resource: MCP_RESOURCE,
        code_challenge: pkce(context.verifier),
        code_challenge_method: "S256",
      },
      context.principal,
    );
    expect(context.state.transactions[0]!.workspaceId).toBeNull();

    await context.oauth.continueAuthorization(
      started.transaction_id,
      context.principal,
    );
    await expect(
      context.oauth.authorizationContext(
        started.transaction_id,
        context.principal,
      ),
    ).resolves.toMatchObject({
      selectedWorkspaceId: null,
      workspaces: expect.arrayContaining([
        expect.objectContaining({ id: context.workspaceId }),
        expect.objectContaining({ id: secondWorkspaceId }),
      ]),
    });

    const consent = await context.oauth.decideAuthorization(
      started.transaction_id,
      true,
      context.principal,
      secondWorkspaceId,
    );
    expect(new URL(consent.url).searchParams.get("state")).toBe(
      "multi-workspace-state",
    );
    expect(context.state.codes[0]!.workspaceId).toBe(secondWorkspaceId);
  });

  it("returns an OAuth access_denied redirect without issuing a code", async () => {
    const context = await fixture();
    const started = await context.oauth.beginAuthorization(
      {
        client_id: context.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        state: "deny-state",
        resource: MCP_RESOURCE,
        code_challenge: pkce(context.verifier),
        code_challenge_method: "S256",
      },
      context.principal,
    );
    const denied = await context.oauth.decideAuthorization(
      started.transaction_id,
      false,
      context.principal,
    );
    expect(denied.url).toContain("error=access_denied");
    expect(denied.url).toContain("state=deny-state");
    expect(context.state.codes).toHaveLength(0);
  });

  it("rejects invalid OAuth access tokens", async () => {
    const context = await fixture();
    expect(await context.oauth.authenticate("hm_oauth_invalid")).toBeNull();
  });

  it("invalidates an OAuth token when its user no longer belongs to the bound workspace", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const token = await context.oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    context.state.memberships.splice(0);
    expect(await context.oauth.authenticate(token.access_token)).toBeNull();
  });

  it("revokes an OAuth access token without affecting other client credentials", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const token = await context.oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    await expect(
      context.oauth.revoke({
        token: token.access_token,
        client_id: context.registered.client_id,
      }),
    ).resolves.toEqual({ revoked: true });
    expect(await context.oauth.authenticate(token.access_token)).toBeNull();
  });
});

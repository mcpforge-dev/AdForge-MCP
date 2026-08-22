import { createHash, randomBytes } from "node:crypto";
import { createDatabase } from "../packages/database/dist/index.js";

const baseUrl = process.env.V2_REHEARSAL_API_URL ?? "http://127.0.0.1:4106";
const database = createDatabase(process.env.DATABASE_URL);
const db = database.client;
let tokenId;
let identityId;
let expiryTokenId;
let expiryIdentityId;

try {
  const provider = process.env.PHASE_B_PROVIDER ?? "GOOGLE_ADS";
  const account = await db.providerAccount.findFirst({
    where: { provider, enabled: true },
    select: { id: true, workspaceId: true, externalAccountId: true },
  });
  if (!account) throw new Error("No enabled Google account in rehearsal DB.");

  const identity = await db.serviceIdentity.create({
    data: { workspaceId: account.workspaceId, name: "phase-b-read-smoke" },
  });
  identityId = identity.id;
  const raw = `hmst_${randomBytes(32).toString("base64url")}`;
  const token = await db.serviceToken.create({
    data: {
      serviceIdentityId: identity.id,
      tokenDigest: createHash("sha256").update(raw).digest("hex"),
      tokenPrefix: raw.slice(0, 13),
      name: "phase-b-read-smoke",
      scopes: ["adforge:mcp:read"],
      accountIds: [account.id],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  tokenId = token.id;

  async function call(name, argumentsValue) {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${raw}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: name,
        method: "tools/call",
        params: { name, arguments: argumentsValue },
      }),
    });
    const body = await response.json();
    const text = body?.result?.content?.[0]?.text;
    try {
      return JSON.parse(text);
    } catch {
      return { error: "invalid_mcp_response", http: response.status };
    }
  }

  const args = {
    provider: provider === "META_ADS" ? "meta_ads" : "google_ads",
    account_id: account.externalAccountId,
    start_date: "2026-08-15",
    end_date: "2026-08-21",
  };
  const campaigns = await call("list_campaigns", args);
  const campaignItems = Array.isArray(campaigns?.items)
    ? campaigns.items
    : Array.isArray(campaigns?.campaigns)
      ? campaigns.campaigns
      : [];
  const metrics = await call("get_basic_metrics", args);
  const diagnostics = await call("run_connection_diagnostics", args);
  const writeAttempt = await call("commit_preview", {
    provider: args.provider,
    account_id: account.externalAccountId,
    preview_token: "hmpp_invalid_operator_smoke_token_000000",
  });
  const foreign = await db.providerAccount.findFirst({
    where: { enabled: true, id: { not: account.id } },
    select: { externalAccountId: true },
  });
  const foreignAttempt = foreign
    ? await call("get_account_status", {
        provider: args.provider,
        account_id: foreign.externalAccountId,
      })
    : null;
  const assets =
    provider === "META_ADS" ? await call("list_meta_businesses", args) : null;
  const pages =
    provider === "META_ADS" ? await call("list_meta_pages", args) : null;
  const permissions =
    provider === "META_ADS"
      ? await call("get_meta_oauth_permissions", args)
      : null;
  const firstBusiness = Array.isArray(assets) ? assets[0]?.id : null;
  const businessAccounts = firstBusiness
    ? await call("list_business_ad_accounts", {
        ...args,
        business_id: firstBusiness,
      })
    : null;
  const firstPage =
    process.env.PHASE_B_META_PAGE_ID ??
    (Array.isArray(pages) ? pages[0]?.id : null);
  const pagePosts = firstPage
    ? await call("list_page_posts", { ...args, page_id: firstPage, limit: 5 })
    : null;
  const instagram = firstPage
    ? await call("get_page_instagram_account", { ...args, page_id: firstPage })
    : null;
  const revokedBefore = await call("list_accounts", {
    provider: args.provider,
  });
  await db.serviceToken.update({
    where: { id: token.id },
    data: { revokedAt: new Date() },
  });
  const revokedResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${raw}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "revoked",
      method: "tools/list",
    }),
  });
  const expiryIdentity = await db.serviceIdentity.create({
    data: { workspaceId: account.workspaceId, name: "phase-b-expiry-smoke" },
  });
  expiryIdentityId = expiryIdentity.id;
  const expiryRaw = `hmst_${randomBytes(32).toString("base64url")}`;
  const expiryToken = await db.serviceToken.create({
    data: {
      serviceIdentityId: expiryIdentity.id,
      tokenDigest: createHash("sha256").update(expiryRaw).digest("hex"),
      tokenPrefix: expiryRaw.slice(0, 13),
      name: "phase-b-expiry-smoke",
      scopes: ["adforge:mcp:read"],
      accountIds: [account.id],
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  expiryTokenId = expiryToken.id;
  const expiredResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${expiryRaw}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "expired",
      method: "tools/list",
    }),
  });
  console.log(
    JSON.stringify({
      provider,
      campaigns: {
        error: campaigns?.error ?? null,
        count: campaignItems.length || null,
        idHash: hashIds(campaignItems),
        keySet: [
          ...new Set(campaignItems.flatMap((item) => Object.keys(item ?? {}))),
        ].sort(),
      },
      metrics: {
        error: metrics?.error ?? null,
        spend: metrics?.spend ?? metrics?.metrics?.spend ?? null,
        impressions:
          metrics?.impressions ?? metrics?.metrics?.impressions ?? null,
        clicks: metrics?.clicks ?? metrics?.metrics?.clicks ?? null,
        conversions:
          metrics?.conversions ?? metrics?.metrics?.conversions ?? null,
      },
      diagnostics: {
        error: diagnostics?.error ?? null,
        status: diagnostics?.status ?? null,
      },
      policy: {
        writeRejected: Boolean(writeAttempt?.message),
        foreignAccountRejected: Boolean(foreignAttempt?.message),
        readBeforeRevocation: Array.isArray(revokedBefore),
        revokedRejected: revokedResponse.status === 401,
        expiredRejected: expiredResponse.status === 401,
      },
      meta:
        provider === "META_ADS"
          ? {
              businesses: {
                error: assets?.error ?? null,
                count: Array.isArray(assets) ? assets.length : null,
              },
              businessAccounts: {
                error: businessAccounts?.error ?? null,
                count: Array.isArray(businessAccounts)
                  ? businessAccounts.length
                  : null,
              },
              pages: {
                error: pages?.error ?? null,
                count: Array.isArray(pages) ? pages.length : null,
              },
              pagePosts: {
                error: pagePosts?.error ?? null,
                count: Array.isArray(pagePosts?.items)
                  ? pagePosts.items.length
                  : null,
                status: pagePosts?.provenance?.dataStatus ?? null,
              },
              instagram: {
                error: instagram?.error ?? null,
                linked: Boolean(instagram?.linkedInstagram),
              },
              permissions: {
                error: permissions?.error ?? null,
                granted: Array.isArray(permissions?.granted)
                  ? permissions.granted.length
                  : null,
                missing: Array.isArray(permissions?.missing)
                  ? permissions.missing.length
                  : null,
              },
            }
          : undefined,
    }),
  );
} finally {
  if (tokenId) await db.serviceToken.delete({ where: { id: tokenId } });
  if (identityId)
    await db.serviceIdentity.delete({ where: { id: identityId } });
  if (expiryTokenId)
    await db.serviceToken.delete({ where: { id: expiryTokenId } });
  if (expiryIdentityId)
    await db.serviceIdentity.delete({ where: { id: expiryIdentityId } });
  await database.pool.end();
}

function hashIds(items) {
  const ids = items
    .map((item) => item?.id ?? item?.campaign_id ?? item?.external_id)
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .sort();
  return createHash("sha256").update(JSON.stringify(ids)).digest("hex");
}

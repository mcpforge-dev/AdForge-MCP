#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { accountMetadata } from "./v2-account-metadata.mjs";

const require = createRequire(import.meta.url);
const pg = require("../packages/database/node_modules/pg");

const inputPath = process.argv[2];
const target = process.env.V2_MIGRATION_TARGET;
const databaseUrl = process.env.V2_DATABASE_URL;
if (!inputPath || target !== "REHEARSAL" || !databaseUrl) {
  console.error(
    "Usage: V2_MIGRATION_TARGET=REHEARSAL V2_DATABASE_URL=<rehearsal-db> node scripts/v2-migration-import.mjs <bundle.json>",
  );
  process.exit(2);
}

const parsedUrl = new URL(databaseUrl);
if (
  !isRehearsalHost(parsedUrl.hostname) ||
  !/(v2|rehearsal|test)/i.test(parsedUrl.pathname)
) {
  console.error(
    "Refusing migration target: only an isolated rehearsal database is allowed.",
  );
  process.exit(2);
}

const bundle = JSON.parse(await readFile(inputPath, "utf8"));
const report = JSON.parse(await runValidation(inputPath));
if (report.errors?.length) {
  console.error("Refusing migration: sanitized bundle validation failed.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
const maps = buildMaps(bundle);
try {
  await client.connect();
  await client.query("BEGIN");
  const counts = {
    users: 0,
    workspaces: 0,
    memberships: 0,
    connections: 0,
    credentials: 0,
    accounts: 0,
    serviceIdentities: 0,
    serviceTokens: 0,
    mcpOAuthClients: 0,
    entitlements: 0,
  };

  for (const user of arrayOf(bundle.users)) {
    const id = maps.userId(user);
    const createdAt = dateOrNow(user.created_at || user.createdAt);
    await client.query(
      `INSERT INTO users (id, email, name, password_hash, status, email_verified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, status=EXCLUDED.status, email_verified_at=EXCLUDED.email_verified_at, updated_at=EXCLUDED.updated_at`,
      [
        id,
        normalizeEmail(user.email),
        safeText(user.name, "User", 160),
        safePasswordHash(user),
        safeStatus(user.status),
        nullableDate(user.email_verified_at || user.emailVerifiedAt),
        createdAt,
      ],
    );
    counts.users += 1;
  }

  for (const workspace of arrayOf(bundle.workspaces)) {
    const id = maps.workspaceId(workspace);
    const createdAt = dateOrNow(workspace.created_at || workspace.createdAt);
    await client.query(
      `INSERT INTO workspaces (id, name, slug, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, updated_at=EXCLUDED.updated_at`,
      [
        id,
        safeText(workspace.name, "Workspace", 160),
        safeSlug(workspace.slug, id),
        createdAt,
      ],
    );
    counts.workspaces += 1;
  }

  for (const membership of arrayOf(
    bundle.memberships || bundle.workspace_memberships,
  )) {
    const id = maps.membershipId(membership);
    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=EXCLUDED.updated_at`,
      [
        id,
        maps.workspaceIdByValue(
          membership.workspace_id || membership.workspaceId,
        ),
        maps.userIdByValue(membership.user_id || membership.userId),
        normalizeRole(membership.role),
        dateOrNow(membership.created_at || membership.createdAt),
      ],
    );
    counts.memberships += 1;
  }

  const ownerByWorkspace = await loadOwners(client);
  for (const oauthClient of arrayOf(
    bundle.mcp_oauth_clients || bundle.mcpOAuthClients,
  )) {
    const workspaceId = maps.workspaceIdByValue(
      oauthClient.workspace_id || oauthClient.workspaceId,
    );
    const userId =
      maps.userIdByValue(oauthClient.user_id || oauthClient.userId) ||
      ownerByWorkspace.get(workspaceId);
    const clientId = safeText(
      oauthClient.client_id || oauthClient.clientId,
      "migrated_client",
      255,
    );
    const clientSecretDigest = safeDigest(
      oauthClient.client_secret_digest || oauthClient.clientSecretDigest,
    );
    await client.query(
      `INSERT INTO mcp_oauth_clients
        (id, client_id, workspace_id, user_id, client_name, redirect_uris, scope, token_endpoint_auth_method, client_secret_digest, client_secret_prefix, status, created_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (client_id) DO UPDATE SET workspace_id=EXCLUDED.workspace_id, user_id=EXCLUDED.user_id, client_name=EXCLUDED.client_name, redirect_uris=EXCLUDED.redirect_uris, scope=EXCLUDED.scope, status=EXCLUDED.status, revoked_at=EXCLUDED.revoked_at`,
      [
        stableUuid("mcp-oauth-client", clientId),
        clientId,
        workspaceId,
        userId,
        safeText(
          oauthClient.client_name || oauthClient.clientName,
          "Migrated MCP client",
          160,
        ),
        JSON.stringify(
          arrayOfStrings(oauthClient.redirect_uris || oauthClient.redirectUris),
        ),
        "adforge:mcp:read",
        "client_secret_basic",
        clientSecretDigest,
        safeText(
          oauthClient.client_secret_prefix || oauthClient.clientSecretPrefix,
          "mcp_oauth",
          32,
        ),
        value(oauthClient.status) === "revoked" ? "revoked" : "active",
        dateOrNow(oauthClient.created_at || oauthClient.createdAt),
        nullableDate(oauthClient.revoked_at || oauthClient.revokedAt),
      ],
    );
    counts.mcpOAuthClients += 1;
  }
  for (const connection of arrayOf(bundle.connections)) {
    const workspaceId = maps.workspaceIdByValue(
      connection.workspace_id || connection.workspaceId,
    );
    const provider = normalizeProvider(connection.provider);
    const id = maps.connectionId(connection);
    const createdBy =
      maps.userIdByValue(connection.created_by || connection.createdBy) ||
      ownerByWorkspace.get(workspaceId);
    if (!createdBy) throw new Error("connection creator is missing");
    const status = normalizeConnectionStatus(
      connection.status,
      connection.reconnect_required || connection.reconnectRequired,
    );
    const createdAt = dateOrNow(connection.created_at || connection.createdAt);
    const saved = await client.query(
      `INSERT INTO provider_connections
        (id, workspace_id, provider, status, external_subject_id, display_name, created_by, created_at, updated_at, connected_at, last_success_at, credential_version, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9,$10,$11)
       ON CONFLICT (workspace_id,provider) DO UPDATE SET status=EXCLUDED.status, external_subject_id=EXCLUDED.external_subject_id, display_name=EXCLUDED.display_name, updated_at=EXCLUDED.updated_at, connected_at=EXCLUDED.connected_at, last_success_at=EXCLUDED.last_success_at, credential_version=EXCLUDED.credential_version, metadata=EXCLUDED.metadata
       RETURNING id`,
      [
        id,
        workspaceId,
        provider,
        status,
        nullableText(
          connection.external_subject_id || connection.externalSubjectId,
          255,
        ),
        nullableText(connection.display_name || connection.displayName, 255),
        createdBy,
        createdAt,
        status === "CONNECTED" ? createdAt : null,
        importCredentialVersion(connection),
        JSON.stringify(scopeMetadata(connection)),
      ],
    );
    const connectionId = saved.rows[0].id;
    const credential = connection.credential || {};
    const ciphertext =
      credential.encrypted_payload || credential.encryptedPayload;
    const encryptionVersion = Number(
      credential.encryption_version || credential.encryptionVersion,
    );
    if (isV2Ciphertext(ciphertext) && Number.isInteger(encryptionVersion)) {
      await client.query(
        `INSERT INTO provider_credentials (id, connection_id, encrypted_payload, encryption_version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5)
         ON CONFLICT (connection_id) DO UPDATE SET encrypted_payload=EXCLUDED.encrypted_payload, encryption_version=EXCLUDED.encryption_version, updated_at=EXCLUDED.updated_at`,
        [
          stableUuid("credential", `${workspaceId}:${provider}`),
          connectionId,
          ciphertext,
          encryptionVersion,
          createdAt,
        ],
      );
      counts.credentials += 1;
    }
    for (const account of arrayOf(connection.accounts)) {
      const externalId = String(
        account.external_account_id ||
          account.externalAccountId ||
          account.account_id ||
          "",
      ).trim();
      const accountId = stableUuid(
        "account",
        `${workspaceId}:${provider}:${externalId}`,
      );
      await client.query(
        `INSERT INTO provider_accounts
          (id, connection_id, workspace_id, provider, external_account_id, display_name, currency, timezone, status, enabled, metadata, discovered_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
         ON CONFLICT (workspace_id,provider,external_account_id) DO UPDATE SET connection_id=EXCLUDED.connection_id, display_name=EXCLUDED.display_name, currency=EXCLUDED.currency, timezone=EXCLUDED.timezone, status=EXCLUDED.status, enabled=EXCLUDED.enabled, metadata=EXCLUDED.metadata, last_seen_at=EXCLUDED.last_seen_at`,
        [
          accountId,
          connectionId,
          workspaceId,
          provider,
          externalId,
          safeText(
            account.display_name || account.displayName || account.name,
            externalId,
            255,
          ),
          nullableText(account.currency, 16),
          nullableText(account.timezone, 80),
          nullableText(account.status, 80),
          Boolean(account.enabled),
          JSON.stringify(accountMetadata(account)),
          dateOrNow(account.discovered_at || account.discoveredAt),
        ],
      );
      maps.accountIds.set(
        `${workspaceId}:${provider}:${externalId}`,
        accountId,
      );
      counts.accounts += 1;
    }
    counts.connections += 1;
  }

  const identityIds = new Map();
  for (const token of arrayOf(bundle.service_tokens || bundle.serviceTokens)) {
    const workspaceId = maps.workspaceIdByValue(
      token.workspace_id || token.workspaceId,
    );
    const sourceIdentity = String(
      token.service_identity_id ||
        token.serviceIdentityId ||
        `workspace:${workspaceId}`,
    ).trim();
    const identityId = stableUuid(
      "service-identity",
      `${workspaceId}:${sourceIdentity}`,
    );
    if (!identityIds.has(`${workspaceId}:${sourceIdentity}`)) {
      await client.query(
        `INSERT INTO service_identities (id, workspace_id, created_by_id, name, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
        [
          identityId,
          workspaceId,
          ownerByWorkspace.get(workspaceId) || null,
          "Migrated service identity",
          dateOrNow(token.created_at || token.createdAt),
        ],
      );
      identityIds.set(`${workspaceId}:${sourceIdentity}`, identityId);
      counts.serviceIdentities += 1;
    }
    const tokenId = maps.tokenId(token);
    await client.query(
      `INSERT INTO service_tokens
        (id, service_identity_id, token_digest, token_prefix, name, scopes, account_ids, created_at, expires_at, revoked_at, last_used_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, scopes=EXCLUDED.scopes, account_ids=EXCLUDED.account_ids, expires_at=EXCLUDED.expires_at, revoked_at=EXCLUDED.revoked_at`,
      [
        tokenId,
        identityId,
        safeDigest(token.token_digest || token.tokenDigest),
        safeText(token.token_prefix || token.tokenPrefix, "mcp_service", 32),
        safeText(token.name, "Migrated service token", 160),
        JSON.stringify(normalizeScopes(token.scopes || token.scope)),
        JSON.stringify(
          mapAccountRestrictions(
            token.account_ids || token.accountIds,
            workspaceId,
            maps,
          ),
        ),
        dateOrNow(token.created_at || token.createdAt),
        nullableDate(token.expires_at || token.expiresAt),
        nullableDate(token.revoked_at || token.revokedAt),
        nullableDate(token.last_used_at || token.lastUsedAt),
      ],
    );
    counts.serviceTokens += 1;
  }

  for (const workspace of arrayOf(bundle.workspaces)) {
    const workspaceId = maps.workspaceId(workspace);
    await client.query(
      `INSERT INTO entitlements (id, workspace_id, feature_key, value, source, created_at, updated_at)
       VALUES ($1,$2,'legacy_access','true','v1_migration',$3,$3)
       ON CONFLICT (workspace_id,feature_key) DO UPDATE SET value='true', source='v1_migration', updated_at=EXCLUDED.updated_at`,
      [
        stableUuid("entitlement", `${workspaceId}:legacy_access`),
        workspaceId,
        new Date(),
      ],
    );
    counts.entitlements += 1;
  }

  await verifyCounts(client, counts);
  await client.query("COMMIT");
  console.log(
    JSON.stringify(
      {
        mode: "apply-to-rehearsal",
        mutatesDatabase: true,
        counts,
        secretOutput: "none",
        rollback: "restore rehearsal backup or discard rehearsal database",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  const diagnostic =
    error && typeof error === "object" ? error : { message: String(error) };
  const code =
    typeof diagnostic.code === "string" ? diagnostic.code : "unknown";
  const message =
    typeof diagnostic.message === "string"
      ? diagnostic.message.replace(
          /(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
          "$1=[REDACTED]",
        )
      : "unknown migration error";
  console.error(
    `Migration failed; transaction rolled back. code=${code}; message=${message.slice(0, 240)}`,
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

async function runValidation(path) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./v2-provider-migration.mjs", import.meta.url)),
        "validate",
        path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : resolve(stderr || stdout),
    );
  });
}

function buildMaps(bundle) {
  const maps = {
    users: new Map(),
    workspaces: new Map(),
    memberships: new Map(),
    connections: new Map(),
    tokens: new Map(),
    accountIds: new Map(),
  };
  for (const row of arrayOf(bundle.users))
    maps.users.set(sourceId(row), stableUuid("user", sourceId(row)));
  for (const row of arrayOf(bundle.workspaces))
    maps.workspaces.set(sourceId(row), stableUuid("workspace", sourceId(row)));
  for (const row of arrayOf(bundle.memberships || bundle.workspace_memberships))
    maps.memberships.set(
      sourceId(row),
      stableUuid("membership", sourceId(row)),
    );
  for (const row of arrayOf(bundle.connections))
    maps.connections.set(
      sourceId(row),
      stableUuid(
        "connection",
        `${maps.workspaces.get(value(row.workspace_id || row.workspaceId))}:${normalizeProvider(row.provider)}`,
      ),
    );
  for (const row of arrayOf(bundle.service_tokens || bundle.serviceTokens))
    maps.tokens.set(sourceId(row), stableUuid("service-token", sourceId(row)));
  return {
    ...maps,
    userId: (row) => maps.users.get(sourceId(row)),
    userIdByValue: (value) => maps.users.get(String(value || "").trim()),
    workspaceId: (row) => maps.workspaces.get(sourceId(row)),
    workspaceIdByValue: (value) =>
      maps.workspaces.get(String(value || "").trim()),
    membershipId: (row) => maps.memberships.get(sourceId(row)),
    connectionId: (row) => maps.connections.get(sourceId(row)),
    tokenId: (row) => maps.tokens.get(sourceId(row)),
  };
}

async function loadOwners(client) {
  const result = await client.query(
    "SELECT workspace_id, user_id FROM workspace_memberships WHERE role='OWNER'",
  );
  return new Map(result.rows.map((row) => [row.workspace_id, row.user_id]));
}

async function verifyCounts(client, counts) {
  const queries = [
    ["users", "SELECT COUNT(*)::int AS count FROM users"],
    ["workspaces", "SELECT COUNT(*)::int AS count FROM workspaces"],
    ["memberships", "SELECT COUNT(*)::int AS count FROM workspace_memberships"],
    ["connections", "SELECT COUNT(*)::int AS count FROM provider_connections"],
    ["credentials", "SELECT COUNT(*)::int AS count FROM provider_credentials"],
    ["accounts", "SELECT COUNT(*)::int AS count FROM provider_accounts"],
    [
      "serviceIdentities",
      "SELECT COUNT(*)::int AS count FROM service_identities",
    ],
    ["serviceTokens", "SELECT COUNT(*)::int AS count FROM service_tokens"],
    ["mcpOAuthClients", "SELECT COUNT(*)::int AS count FROM mcp_oauth_clients"],
    ["entitlements", "SELECT COUNT(*)::int AS count FROM entitlements"],
  ];
  for (const [key, sql] of queries) {
    const result = await client.query(sql);
    if (Number(result.rows[0].count) < counts[key])
      throw new Error(`verification count mismatch: ${key}`);
  }
}

function sourceId(row) {
  return String(row.id || row.source_id || row.sourceId || "").trim();
}
function value(input) {
  return String(input || "").trim();
}
function arrayOf(input) {
  return Array.isArray(input)
    ? input.filter((item) => item && typeof item === "object")
    : [];
}
function isRehearsalHost(host) {
  return ["localhost", "127.0.0.1", "::1", "postgres"].includes(host);
}
function stableUuid(namespace, source) {
  const hash = createHash("sha1")
    .update(`holymedia-v2:${namespace}:${source}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function normalizeEmail(input) {
  return value(input).toLowerCase();
}
function safeText(input, fallback, max) {
  const text = value(input) || fallback;
  return text.slice(0, max);
}
function nullableText(input, max) {
  const text = value(input);
  return text ? text.slice(0, max) : null;
}
function safeSlug(input, id) {
  return (
    value(input)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 110) || `workspace-${id.slice(0, 8)}`
  );
}
function safeStatus(input) {
  return ["active", "disabled", "suspended"].includes(
    value(input).toLowerCase(),
  )
    ? value(input).toLowerCase()
    : "active";
}
function safePasswordHash(row) {
  const hash = String(row.password_hash || row.passwordHash || "");
  return hash.slice(0, 255);
}
function normalizeRole(input) {
  const role = value(input).toUpperCase();
  return role === "USER"
    ? "MEMBER"
    : ["OWNER", "ADMIN", "MEMBER", "VIEWER"].includes(role)
      ? role
      : "MEMBER";
}
function normalizeProvider(input) {
  const value = String(input || "")
    .trim()
    .toUpperCase();
  const aliases = {
    GOOGLE_ADS: "GOOGLE_ADS",
    META_ADS: "META_ADS",
    GOOGLE_SEARCH_CONSOLE: "GOOGLE_SEARCH_CONSOLE",
    YANDEX_DIRECT: "YANDEX_DIRECT",
    TIKTOK_ADS: "TIKTOK_ADS",
    TEST_PROVIDER: "TEST_PROVIDER",
    GOOGLE_ADS_: "GOOGLE_ADS",
  };
  return aliases[value] || value;
}
function normalizeConnectionStatus(input, reconnect) {
  if (reconnect) return "REAUTH_REQUIRED";
  const value = String(input || "").toUpperCase();
  return [
    "PENDING",
    "CONNECTED",
    "DEGRADED",
    "REAUTH_REQUIRED",
    "REVOKED",
    "DISCONNECTED",
    "ERROR",
  ].includes(value)
    ? value
    : "PENDING";
}
function isV2Ciphertext(value) {
  return (
    typeof value === "string" &&
    /^hm1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  );
}
function importCredentialVersion(row) {
  const value =
    row.credential?.encryption_version || row.credential?.encryptionVersion;
  return Number.isInteger(Number(value)) ? Number(value) : 0;
}
function scopeMetadata(row) {
  return {
    requestedScopes: arrayOfStrings(
      row.requested_scopes || row.requestedScopes,
    ),
    grantedScopes: arrayOfStrings(row.granted_scopes || row.grantedScopes),
    missingScopes: arrayOfStrings(row.missing_scopes || row.missingScopes),
  };
}
function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").slice(0, 100)
    : [];
}
function safeMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function safeDigest(input) {
  const value = String(input || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("service token digest is invalid");
  return value.toLowerCase();
}
function normalizeScopes(input) {
  const values = Array.isArray(input) ? input : [input || "adforge:mcp:read"];
  return [
    ...new Set(
      values
        .map((item) =>
          value(item) === "adforge:mcp" ? "adforge:mcp:read" : value(item),
        )
        .filter(
          (item) => item === "adforge:mcp:read" || item === "adforge:mcp:write",
        ),
    ),
  ];
}
function mapAccountRestrictions(input, workspaceId, maps) {
  const values = Array.isArray(input)
    ? input
    : Object.values(input && typeof input === "object" ? input : {}).flat();
  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map(
      (item) =>
        maps.accountIds.get(`${workspaceId}:GOOGLE_ADS:${item}`) ||
        maps.accountIds.get(`${workspaceId}:META_ADS:${item}`) ||
        item,
    );
}
function dateOrNow(input) {
  const date = input ? new Date(input) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
function nullableDate(input) {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

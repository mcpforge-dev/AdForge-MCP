#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROVIDERS = new Set([
  "GOOGLE_ADS",
  "META_ADS",
  "GOOGLE_SEARCH_CONSOLE",
  "YANDEX_DIRECT",
  "TIKTOK_ADS",
  "TEST_PROVIDER",
]);
const ROLES = new Set(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const SECRET_KEYS = new Set([
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "client_secret",
  "clientSecret",
  "app_secret",
  "appSecret",
  "developer_token",
  "developerToken",
  "raw_token",
  "rawToken",
  "session_token",
  "sessionToken",
  "password",
  "cookie",
  "private_key",
]);

const allowedModes = new Set(["inspect", "validate", "dry-run"]);
const mode = process.argv[2] || "inspect";
const inputPath = process.argv[3];

if (!allowedModes.has(mode) || !inputPath) {
  console.error(
    "Usage: node scripts/v2-provider-migration.mjs <inspect|validate|dry-run> <v1-migration-bundle.json>",
  );
  process.exit(2);
}

const parsed = JSON.parse(await readFile(inputPath, "utf8"));
const result = buildReport(parsed, mode);
if (mode === "validate" && result.errors.length > 0) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));

function buildReport(input, selectedMode) {
  const bundle = normalizeBundle(input);
  const errors = [...bundle.errors];
  const warnings = [];
  scanForSecrets(input, "bundle", errors);
  const maps = {
    users: new Set(),
    workspaces: new Set(),
    memberships: new Set(),
    connections: new Set(),
    accounts: new Set(),
    serviceTokens: new Set(),
    mcpOAuthClients: new Set(),
  };
  const counters = {
    users: bundle.users.length,
    workspaces: bundle.workspaces.length,
    memberships: bundle.memberships.length,
    connections: bundle.connections.length,
    accounts: 0,
    serviceIdentities: 0,
    serviceTokens: bundle.serviceTokens.length,
    mcpOAuthClients: bundle.mcpOAuthClients.length,
    entitlements: bundle.entitlements.length,
  };
  const credentialMigration = {
    encryptedPreserved: 0,
    reconnectRequired: 0,
    unsupportedLegacyCiphertext: 0,
  };
  const passwordMigration = {
    transitionalPbkdf2: 0,
    resetRequired: 0,
  };
  const actions = createActions();

  for (const user of bundle.users) {
    const id = requireId(user, "user", errors);
    if (id && !maps.users.has(id)) {
      maps.users.add(id);
      actions.users.create += 1;
    } else if (id) errors.push(`duplicate user id: ${id}`);
    const hash = String(user.password_hash || user.passwordHash || "");
    if (hash.startsWith("pbkdf2_sha256$"))
      passwordMigration.transitionalPbkdf2 += 1;
    else if (!hash || !hash.startsWith("$argon2"))
      passwordMigration.resetRequired += 1;
  }

  for (const workspace of bundle.workspaces) {
    const id = requireId(workspace, "workspace", errors);
    if (id && !maps.workspaces.has(id)) {
      maps.workspaces.add(id);
      actions.workspaces.create += 1;
    } else if (id) errors.push(`duplicate workspace id: ${id}`);
  }

  for (const membership of bundle.memberships) {
    const id = String(
      membership.id || `${membership.workspace_id}:${membership.user_id}`,
    ).trim();
    const workspaceId = String(
      membership.workspace_id || membership.workspaceId || "",
    ).trim();
    const userId = String(membership.user_id || membership.userId || "").trim();
    if (!workspaceId || !maps.workspaces.has(workspaceId))
      errors.push(`membership ${id} references unknown workspace`);
    if (!userId || !maps.users.has(userId))
      errors.push(`membership ${id} references unknown user`);
    const role = normalizeRole(membership.role);
    if (!role) errors.push(`membership ${id} has unsupported role`);
    if (maps.memberships.has(id)) errors.push(`duplicate membership id: ${id}`);
    else {
      maps.memberships.add(id);
      actions.memberships.create += 1;
    }
  }

  for (const connection of bundle.connections) {
    const id = requireId(connection, "connection", errors);
    const workspaceId = String(
      connection.workspace_id || connection.workspaceId || "",
    ).trim();
    const provider = normalizeProvider(connection.provider);
    if (!workspaceId || !maps.workspaces.has(workspaceId))
      errors.push(
        `connection ${id || "<unknown>"} references unknown workspace`,
      );
    if (!provider)
      errors.push(`connection ${id || "<unknown>"} has unsupported provider`);
    const key = `${workspaceId}:${provider}`;
    if (maps.connections.has(key))
      errors.push(`duplicate connection scope: ${key}`);
    else {
      maps.connections.add(key);
      actions.connections.create += 1;
    }
    const accounts = Array.isArray(connection.accounts)
      ? connection.accounts
      : [];
    counters.accounts += accounts.length;
    for (const account of accounts) {
      const externalId = String(
        account.external_account_id ||
          account.externalAccountId ||
          account.account_id ||
          "",
      ).trim();
      if (!externalId) {
        errors.push(
          `connection ${id || "<unknown>"} contains account without external id`,
        );
        continue;
      }
      const accountKey = `${workspaceId}:${provider}:${externalId}`;
      if (maps.accounts.has(accountKey))
        errors.push(`duplicate provider account scope: ${accountKey}`);
      else {
        maps.accounts.add(accountKey);
        actions.accounts.create += 1;
      }
    }
    const credential = connection.credential || {};
    const encryptedPayload =
      credential.encrypted_payload || credential.encryptedPayload;
    if (encryptedPayload) {
      if (
        isV2Ciphertext(encryptedPayload) &&
        Number.isInteger(
          Number(credential.encryption_version || credential.encryptionVersion),
        )
      ) {
        credentialMigration.encryptedPreserved += 1;
      } else {
        credentialMigration.unsupportedLegacyCiphertext += 1;
        credentialMigration.reconnectRequired += 1;
        warnings.push(
          `connection ${id || "<unknown>"}: legacy credential envelope requires controlled in-memory bridge`,
        );
      }
    } else if (
      connection.credential_present === true ||
      connection.credentialPresent === true ||
      connection.reconnect_required === true ||
      connection.reconnectRequired === true
    ) {
      credentialMigration.reconnectRequired += 1;
      warnings.push(
        `connection ${id || "<unknown>"}: credential metadata is present but no importable encrypted envelope was supplied`,
      );
    }
  }

  const identityKeys = new Set();
  for (const token of bundle.serviceTokens) {
    const id = requireId(token, "service token", errors);
    const workspaceId = String(
      token.workspace_id || token.workspaceId || "",
    ).trim();
    if (!workspaceId || !maps.workspaces.has(workspaceId))
      errors.push(
        `service token ${id || "<unknown>"} references unknown workspace`,
      );
    if (!String(token.token_digest || token.tokenDigest || "").trim())
      errors.push(`service token ${id || "<unknown>"} has no digest`);
    const identityKey = String(
      token.service_identity_id ||
        token.serviceIdentityId ||
        `workspace:${workspaceId}`,
    ).trim();
    identityKeys.add(identityKey);
    if (maps.serviceTokens.has(id))
      errors.push(`duplicate service token id: ${id}`);
    else {
      maps.serviceTokens.add(id);
      actions.serviceTokens.create += 1;
    }
  }
  counters.serviceIdentities = identityKeys.size;

  for (const oauthClient of bundle.mcpOAuthClients) {
    const id = requireId(oauthClient, "MCP OAuth client", errors);
    const workspaceId = String(
      oauthClient.workspace_id || oauthClient.workspaceId || "",
    ).trim();
    const userId = String(
      oauthClient.user_id || oauthClient.userId || "",
    ).trim();
    if (!workspaceId || !maps.workspaces.has(workspaceId))
      errors.push(
        `MCP OAuth client ${id || "<unknown>"} references unknown workspace`,
      );
    if (userId && !maps.users.has(userId))
      errors.push(
        `MCP OAuth client ${id || "<unknown>"} references unknown user`,
      );
    if (
      !/^[a-f0-9]{64}$/i.test(
        String(
          oauthClient.client_secret_digest ||
            oauthClient.clientSecretDigest ||
            "",
        ).trim(),
      )
    )
      errors.push(
        `MCP OAuth client ${id || "<unknown>"} must contain a SHA-256 client secret digest`,
      );
    if (id && maps.mcpOAuthClients.has(id))
      errors.push(`duplicate MCP OAuth client id: ${id}`);
    else if (id) {
      maps.mcpOAuthClients.add(id);
      actions.mcpOAuthClients.create += 1;
    }
  }

  if (
    !bundle.users.length &&
    !bundle.workspaces.length &&
    bundle.connections.length
  ) {
    warnings.push(
      "legacy connection-only export: it can be inspected, but cannot be applied as a complete tenant migration",
    );
  }
  if (passwordMigration.resetRequired > 0) {
    warnings.push(
      "some password hashes are not recognized; those users need password reset before V2 login",
    );
  }

  return {
    mode: selectedMode,
    schemaVersion: bundle.schema_version,
    source: bundle.source,
    mutatesDatabase: false,
    counts: counters,
    actions: selectedMode === "dry-run" ? actions : undefined,
    credentialMigration,
    passwordMigration,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    verification: {
      referentialIntegrity: errors.length === 0 ? "ready" : "blocked",
      idempotencyKey:
        "source entity id + workspace/provider/external account scope",
      secretOutput: "none",
      rollback:
        "No database mutation. Discard the rehearsal database or restore its backup.",
    },
  };
}

function normalizeBundle(input) {
  const source = input && typeof input === "object" ? input : {};
  const legacyConnections = Array.isArray(source)
    ? source
    : Array.isArray(source.connections)
      ? source.connections
      : [];
  const fullBundle = Array.isArray(source) ? {} : source;
  const errors = [];
  if (
    !Array.isArray(source) &&
    source.schema_version !== undefined &&
    Number(source.schema_version) !== 1
  ) {
    errors.push("unsupported migration bundle schema_version");
  }
  return {
    schema_version: Number(fullBundle.schema_version || 1),
    source: safeSource(fullBundle.source),
    users: arrayOf(fullBundle.users),
    workspaces: arrayOf(fullBundle.workspaces),
    memberships: arrayOf(
      fullBundle.memberships || fullBundle.workspace_memberships,
    ),
    connections: legacyConnections,
    serviceTokens: arrayOf(
      fullBundle.service_tokens || fullBundle.serviceTokens,
    ),
    mcpOAuthClients: arrayOf(
      fullBundle.mcp_oauth_clients || fullBundle.mcpOAuthClients,
    ),
    entitlements: arrayOf(fullBundle.entitlements),
    errors,
  };
}

function safeSource(value) {
  if (!value || typeof value !== "object")
    return { system: "v1", export: "sanitized" };
  return {
    system: String(value.system || "v1").slice(0, 80),
    export: String(value.export || "sanitized").slice(0, 80),
    databaseEngine: value.database_engine
      ? String(value.database_engine).slice(0, 40)
      : undefined,
  };
}

function arrayOf(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object")
    : [];
}

function createActions() {
  return {
    users: { create: 0, update: 0, skip: 0 },
    workspaces: { create: 0, update: 0, skip: 0 },
    memberships: { create: 0, update: 0, skip: 0 },
    connections: { create: 0, update: 0, skip: 0 },
    accounts: { create: 0, update: 0, skip: 0 },
    serviceTokens: { create: 0, update: 0, skip: 0 },
    mcpOAuthClients: { create: 0, update: 0, skip: 0 },
  };
}

function requireId(record, label, errors) {
  const id = String(
    record.id || record.source_id || record.sourceId || "",
  ).trim();
  if (!id) errors.push(`${label} id is missing`);
  return id;
}

function normalizeProvider(value) {
  const aliases = {
    google_ads: "GOOGLE_ADS",
    meta_ads: "META_ADS",
    google_search_console: "GOOGLE_SEARCH_CONSOLE",
    yandex_direct: "YANDEX_DIRECT",
    tiktok_ads: "TIKTOK_ADS",
    test_provider: "TEST_PROVIDER",
  };
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return PROVIDERS.has(normalized)
    ? normalized
    : aliases[
        String(value || "")
          .trim()
          .toLowerCase()
      ];
}

function normalizeRole(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (ROLES.has(normalized)) return normalized;
  if (normalized === "USER") return "MEMBER";
  if (normalized === "OWNER" || normalized === "ADMIN") return normalized;
  return undefined;
}

function isV2Ciphertext(value) {
  return (
    typeof value === "string" &&
    /^hm1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  );
}

function scanForSecrets(value, path, errors) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanForSecrets(item, `${path}[${index}]`, errors),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key))
      errors.push(
        `secret-bearing field is not allowed in sanitized bundle: ${path}.${key}`,
      );
    if (/^oauth_?(token|secret)$/i.test(key))
      errors.push(
        `secret-bearing field is not allowed in sanitized bundle: ${path}.${key}`,
      );
    scanForSecrets(child, `${path}.${key}`, errors);
  }
}

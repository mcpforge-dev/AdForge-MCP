#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { accountMetadata } from "./v2-account-metadata.mjs";

const require = createRequire(import.meta.url);
const pg = require("../packages/database/node_modules/pg");

export function googleMetadataFromV1(account) {
  const metadata = accountMetadata(account);
  return Object.fromEntries(
    [
      "loginCustomerId",
      "managerCustomerId",
      "googleAdsType",
      "googleAdsLevel",
      "googleAdsStatus",
    ]
      .filter((key) => metadata[key] !== undefined)
      .map((key) => [key, metadata[key]]),
  );
}

export function stableUuid(namespace, source) {
  const hash = createHash("sha1")
    .update(`holymedia-v2:${namespace}:${source}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function value(input) {
  return String(input || "").trim();
}

function arrayOf(input) {
  return Array.isArray(input)
    ? input.filter((item) => item && typeof item === "object")
    : [];
}

function isGoogleAds(input) {
  return ["GOOGLE_ADS", "GOOGLEADS", "GOOGLE_ADWORDS"].includes(
    value(input).replace(/[-\s]/g, "_").toUpperCase(),
  );
}

async function main() {
  const inputPath = process.argv[2];
  const databaseUrl = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
  const apply = process.env.V2_GOOGLE_METADATA_REPAIR === "CONFIRMED";
  if (!inputPath || !databaseUrl) {
    console.error(
      "Usage: DATABASE_URL=<target-db> node scripts/v2-google-metadata-repair.mjs <v1-bundle.json>",
    );
    process.exit(2);
  }

  const bundle = JSON.parse(await readFile(inputPath, "utf8"));
  const client = new pg.Client({ connectionString: databaseUrl });
  const report = { sourceCandidates: 0, matched: 0, updated: 0, missing: 0 };
  await client.connect();
  try {
    if (apply) await client.query("BEGIN");
    for (const connection of arrayOf(bundle.connections)) {
      if (!isGoogleAds(connection.provider)) continue;
      const sourceWorkspaceId = value(
        connection.workspace_id ?? connection.workspaceId,
      );
      if (!sourceWorkspaceId) continue;
      const workspaceId = stableUuid("workspace", sourceWorkspaceId);
      for (const account of arrayOf(connection.accounts)) {
        const externalAccountId = value(
          account.external_account_id ??
            account.externalAccountId ??
            account.account_id,
        );
        const metadata = googleMetadataFromV1(account);
        if (!externalAccountId || !Object.keys(metadata).length) continue;
        report.sourceCandidates += 1;
        const existing = await client.query(
          `SELECT metadata FROM provider_accounts
           WHERE workspace_id = $1 AND provider = 'GOOGLE_ADS' AND external_account_id = $2`,
          [workspaceId, externalAccountId],
        );
        if (existing.rowCount !== 1) {
          report.missing += 1;
          continue;
        }
        report.matched += 1;
        const current = existing.rows[0].metadata ?? {};
        const merged = { ...current, ...metadata };
        if (JSON.stringify(current) === JSON.stringify(merged)) continue;
        if (apply) {
          await client.query(
            `UPDATE provider_accounts SET metadata = $3::jsonb
             WHERE workspace_id = $1 AND provider = 'GOOGLE_ADS' AND external_account_id = $2`,
            [workspaceId, externalAccountId, JSON.stringify(merged)],
          );
        }
        report.updated += 1;
      }
    }
    if (apply) await client.query("COMMIT");
    console.log(
      JSON.stringify({ mode: apply ? "apply" : "dry-run", ...report }),
    );
  } catch (error) {
    if (apply) await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const allowedModes = new Set(["inspect", "validate", "dry-run"]);
const mode = process.argv[2] || "inspect";
const inputPath = process.argv[3];

if (!allowedModes.has(mode) || !inputPath) {
  console.error(
    "Usage: node scripts/v2-provider-migration.mjs <inspect|validate|dry-run> <sanitized-export.json>",
  );
  process.exitCode = 2;
} else {
  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.connections)
      ? parsed.connections
      : [];
  const report = inspect(records);
  if (mode === "validate" && report.errors.length > 0) {
    console.error(
      JSON.stringify({ mode, valid: false, errors: report.errors }, null, 2),
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({ mode, mutatesDatabase: false, ...report }, null, 2),
    );
  }
}

function inspect(records) {
  const errors = [];
  const providers = new Map();
  let accounts = 0;
  let reconnectRequired = 0;
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object") {
      errors.push(`record[${index}] is not an object`);
      continue;
    }
    const provider = String(record.provider || "").trim();
    const workspace = String(
      record.workspace_id || record.workspaceId || "",
    ).trim();
    if (!provider) errors.push(`record[${index}] provider is missing`);
    if (!workspace) errors.push(`record[${index}] workspace is missing`);
    providers.set(provider, (providers.get(provider) || 0) + 1);
    const listedAccounts = Array.isArray(record.accounts)
      ? record.accounts
      : [];
    accounts += listedAccounts.length;
    if (
      record.reconnect_required === true ||
      record.credential_present === false
    )
      reconnectRequired += 1;
  }
  return {
    connections: records.length,
    accounts,
    providers: Object.fromEntries(providers),
    unsupportedRecords: errors.length,
    reconnectRequired,
    errors,
    secretOutput: "none",
  };
}

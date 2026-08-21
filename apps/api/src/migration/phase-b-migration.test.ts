import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../../../../scripts/v2-provider-migration.mjs");
const fixture = resolve(
  here,
  "../../../../scripts/fixtures/v2-migration-bundle.example.json",
);

function run(mode: string, input: string): { status: number; output: string } {
  try {
    return {
      status: 0,
      output: execFileSync(process.execPath, [script, mode, input], {
        encoding: "utf8",
      }),
    };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("Phase B migration rehearsal contract", () => {
  it("builds an idempotent dry-run without printing secrets", () => {
    const result = run("dry-run", fixture);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.output) as {
      mutatesDatabase: boolean;
      counts: {
        users: number;
        connections: number;
        accounts: number;
        mcpOAuthClients: number;
      };
      credentialMigration: {
        encryptedPreserved: number;
        reconnectRequired: number;
      };
      passwordMigration: { transitionalPbkdf2: number };
    };
    expect(report.mutatesDatabase).toBe(false);
    expect(report.counts).toMatchObject({
      users: 1,
      connections: 2,
      accounts: 1,
      mcpOAuthClients: 1,
    });
    expect(report.credentialMigration).toMatchObject({
      encryptedPreserved: 1,
      reconnectRequired: 1,
    });
    expect(report.passwordMigration.transitionalPbkdf2).toBe(1);
    expect(result.output).not.toContain("access_token");
    expect(result.output).not.toContain("refresh_token");
  });

  it("rejects a bundle containing plaintext credential fields", () => {
    const path = join(tmpdir(), `v2-migration-secret-${Date.now()}.json`);
    const payload = JSON.parse(readFileSync(fixture, "utf8")) as Record<
      string,
      unknown
    >;
    payload.connections = [
      {
        provider: "GOOGLE_ADS",
        workspace_id: "w",
        access_token: "must-not-pass",
      },
    ];
    try {
      writeFileSync(path, JSON.stringify(payload), "utf8");
      const result = run("validate", path);
      expect(result.status).toBe(1);
      expect(result.output).toContain("secret-bearing field");
      expect(result.output).not.toContain("must-not-pass");
    } finally {
      unlinkSync(path);
    }
  });
});

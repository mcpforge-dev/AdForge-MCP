# HolyMedia MCP V2 - Phase C Cutover Result

Date: 2026-08-22/23 UTC

This is a sanitized operator record. It contains no credentials, tokens,
cookies, keys or secret-bearing environment values.

## Runtime

- V1 source commit: `c700fb7cf46884ad91bf4f8edc7b723a673f1446`.
- V2 runtime/config commit: `346ea45`.
- V2 image: GHCR immutable SHA tag from the green production-image workflow.
- PostgreSQL: 18-alpine, private loopback port, persistent V2 volume.
- Redis: 7.4.11, private loopback port, isolated V2 volume.
- API, worker and web: healthy; V1 services remained online.

## Backup and migration

- Backup: `/var/backups/adforge-mcp/phase-c-20260822T204959Z`.
- Backup manifest, readability and SHA-256 checksums: verified.
- Migrated counts: 11 users, 11 workspaces, 11 memberships, 10 connections,
  9 encrypted credential envelopes, 191 provider accounts, 7 service
  identities, 12 service tokens, 1 MCP OAuth client and 11 legacy entitlements.
- PostgreSQL migrations: applied successfully on PostgreSQL 18.
- Import rerun: idempotent, stable counts, zero duplicates.
- Credential migration: V1 Fernet envelopes were converted in memory to V2
  AES-GCM envelopes. All 9 V2 envelopes decrypted successfully. Plaintext was
  not written to disk or logs.
- Service-token compatibility: all 12 SHA-256 digest records are identical
  before and after migration. No production plaintext token was reconstructed.

## Cutover

- Nginx `-t`: passed; reload: passed.
- Existing public hostname, DNS, TLS, OAuth applications and callback URLs:
  unchanged.
- V1 upstreams remain available on ports `8765/8766` and the V1 services are
  retained for rollback and observation.
- V2 public health/readiness: 200/200.
- Unauthenticated public `/mcp`: 401 as expected.

## Provider smoke

- Meta migrated connection: read-only smoke passed for campaigns, metrics,
  diagnostics, Business, Pages and live Page posts. No mutations executed.
- Yandex and TikTok: migrated credential decrypt and V1-compatible discovery
  smoke passed. No unsupported reporting parity was claimed.
- Google: `N/A - no production connection`.

## Browser and security

- Public desktop/mobile browser shell smoke: passed.
- Controlled V2 auth smoke: signup, session, dashboard, workspace selector and
  Billing/legacy entitlement loaded successfully; zero console/request failures.
- Secrets were not printed. Runtime logs and migration outputs were checked
  for token/credential leakage.
- Critical findings: 0. High findings: 0.

## Deferred items and rollback

- Telegram Hermes real E2E: `DEFERRED BY PROJECT DECISION`.
- Payment gateway and expanded Yandex/TikTok reporting are outside this
  cutover scope.
- Rollback: restore the backed-up Nginx upstream, run `nginx -t`, reload Nginx,
  verify V1 health/auth/MCP/provider reads, and retain V2 DB/logs for diagnosis.

## Verdict

**PHASE C COMPLETE - V2 IS PRODUCTION**

**V1 RETAINED FOR ROLLBACK / OBSERVATION PERIOD**

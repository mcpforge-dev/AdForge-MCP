# HolyMedia MCP V2 - Post-Cutover Stabilization

Date: 2026-08-22/23 UTC

This report is sanitized and contains no credentials, tokens, cookies, keys or
secret-bearing environment values.

## Disk remediation

- Before: approximately `1.4 GB` free, `93%` used.
- After: approximately `3.4 GB` free, `83%` used.
- Removed: archived systemd journal data and apt cache only.
- Journal policy: 250 MB system cap, 100 MB runtime cap, 14-day retention.
- Docker rotation: json-file; API/worker/web `20m x 5`, PostgreSQL/Redis
  `10m x 5`.
- Preserved: current V2 image/layers, PostgreSQL, Redis, V1 runtime, all
  rollback backups, encryption material and active configuration.

## Stability

- PostgreSQL 18, Redis 7.4.11, API, worker and web: healthy.
- Container restart count: `0`.
- Public `/health`: `200`.
- Public `/ready`: `200`.
- OOM events in checked 24-hour window: `0`.
- Disk-full warnings in checked 24-hour window: `0`.
- V1 services remain active on ports `8765/8766`.

Historical high-severity API log entries were attributable to expected
unauthenticated probes and the controlled browser auth rate-limit smoke. No
recurring application crash, container restart or provider credential failure
was observed.

## Provider observation

- Meta: migrated credential/read path passed for campaigns, metrics,
  diagnostics, Business, Pages and live Page posts.
- Yandex: V1-compatible OAuth/discovery capability remains available.
- TikTok: V1-compatible OAuth/discovery capability remains available.
- Google: `N/A - no production connection`.

No provider mutations or reconnects were performed.

## MCP and billing

Temporary scoped observation checks passed for authentication, representative
read, foreign-account rejection, write default-deny, revoked-token rejection
and expired-token rejection. Temporary credentials were deleted after the
check; existing production token plaintext was neither recovered nor changed.

Migrated workspaces retain `legacy_internal` entitlement and are not dependent
on a payment gateway.

## Browser and security

Desktop/mobile production browser smoke passed with no console errors or failed
requests. Secret scan passed; dependency audit reported no known vulnerabilities.
Critical findings: `0`. High findings: `0`.

## Backup and rollback

- Previous Phase C backup remained readable and checksum-valid:
  `/var/backups/adforge-mcp/phase-c-20260822T204959Z`.
- New post-cutover backup, checksum-verified:
  `/var/backups/adforge-mcp/post-cutover-v2-20260822T214700Z`.
- It contains PostgreSQL dump, Redis persistent state, V2 deployment config,
  current Nginx config and immutable `nginx-v1-rollback.conf`.
- Rollback remains an Nginx-only upstream restore followed by `nginx -t`,
  reload and V1 health/auth/MCP smoke. V2 data is retained for diagnosis.

## Verdict

**POST-CUTOVER STABILIZATION PASSED**

**V1 DECOMMISSION READY - AWAITING OWNER APPROVAL**

V1 was not stopped, deleted or decommissioned. Telegram Hermes real E2E remains
`DEFERRED BY PROJECT DECISION`.

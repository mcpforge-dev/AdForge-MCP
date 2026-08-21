# Phase C: in-place cutover runbook

Этот runbook подготовлен для отдельного approval. В Phase B он только документируется и не выполняется.

## Before change

1. Freeze new writes and OAuth/account selection for the shortest possible window.
2. Create and verify V1 database/runtime backups. Never print backup paths containing secrets or copy backups into Git.
3. Run the final V1 → V2 migration against a fresh isolated target DB.
4. Verify counts, FK/unique constraints, owner invariants, encrypted credential envelopes, selected accounts, service-token restrictions and legacy entitlements.
5. Start V2 beside V1 on an internal port with production env mapping and the same public base/callback URLs.
6. Run health, readiness, login, migrated-user, Google, Meta, MCP and worker read-only smoke tests.

## Switch

1. Keep `mcp.holymedia.kz`, DNS and TLS unchanged.
2. Change only the existing reverse-proxy upstream from V1 service to the V2 internal service.
3. Reload Nginx, do not stop V1 yet.
4. Verify `/health`, `/ready`, `/mcp` auth, existing OAuth callback routes and one existing read-only client.
5. Unfreeze writes only after all checks pass.

## Rollback

1. Freeze writes again.
2. Point the same upstream back to V1.
3. Reload Nginx; DNS and OAuth provider settings remain untouched.
4. Revoke or isolate any V2-only sessions created during the observation window as defined by the incident owner.
5. Preserve V2 logs/metrics and the migration report for investigation.

## Stop conditions

Rollback immediately on any tenant-isolation failure, credential decrypt failure, callback mismatch, existing MCP token failure, provider read divergence, migration count mismatch or unredacted secret in logs.

## Expected maintenance window

Plan for a short write-freeze covering final backup, migration, integrity checks and proxy reload. The exact duration must be measured in rehearsal; do not promise a fixed duration before the rehearsal is complete.

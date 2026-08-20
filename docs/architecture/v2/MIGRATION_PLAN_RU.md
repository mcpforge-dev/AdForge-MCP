# Migration Plan

No phase below is authorized by this Phase 0 document. Each phase needs its own tests, docs, commit and rollback point.

## Phase 1: foundation

Create pnpm workspace, Next app, Nest API, worker skeleton, shared contracts, Docker Compose, local observability, CI gates and migration tool. Keep v1 untouched.

## Phase 2: identity and tenancy

Implement users, sessions, organizations/workspaces, memberships, RBAC, password reset and tenant policy. Import only non-secret metadata first. Add isolation tests and dual-read diagnostics.

## Phase 3: provider framework and OAuth

Define adapter/error/capability contracts, encrypted connection repository, OAuth transaction/state/PKCE model, account normalization and provider health. No provider write enablement.

## Phase 4: Google/Meta reads

Migrate account discovery, campaigns, metrics, Business/Page/Instagram reads and provenance. Run real staging smoke with separate OAuth clients/tokens. Compare v1/v2 golden reports.

## Phase 5: MCP and safe writes

Versioned MCP gateway, service tokens, tool registry, policy engine, preview/confirmation/commit/reread/audit. Default read-only. Test foreign workspace/account, expired/replay confirmation and read-token write denial.

## Phase 6: Hermes

Locate or separate current bot runtime, make it an API consumer with scoped read token, preserve thread/reply behavior, add free deterministic analytics and rate limits. No direct DB/provider secret access.

## Phase 7: web/SEO/dashboard/reports

Migrate public SEO pages and private dashboard. Move report/site analysis to jobs and artifact storage; verify DOCX/PDF visual parity and access control.

## Phase 8: billing

Add plan/price/subscription/entitlement/usage model, provider-neutral payments and webhook idempotency. Keep feature limits server-side.

## Phase 9: analytics/observability/admin

Add privacy-safe events, metrics/traces, error tracking adapter, admin policies, audit UI and notifications.

## Phase 10: parity and data migration

Run repeatable dry-run importer, backup, count/referential checks, dual reads, staged credentials migration and report comparison. Maintain v1 rollback.

## Phase 11-12: QA and soak

Full unit/integration/contract/E2E/security/performance suite, restore test, staging soak, provider permission re-check and incident drill.

## Phase 13-14: controlled cutover/decommission

Canary or route-by-route cutover only after sign-off. Keep v1 live and rollback-capable during observation. Decommission only after stable metrics, backup validation and explicit approval.

## Data migration controls

`dry_run -> backup -> import metadata -> import encrypted credentials -> reconcile counts -> FK validation -> provider smoke -> report comparison -> approval`. Every step is idempotent and emits counts/IDs only, never secrets. Rollback is route rollback plus restoration of the pre-migration backup, not destructive reverse SQL on production.


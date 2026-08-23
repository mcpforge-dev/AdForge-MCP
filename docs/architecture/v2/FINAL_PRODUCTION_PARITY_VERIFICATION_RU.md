# HolyMedia MCP V2 Final Production Parity Verification

Verification date: `2026-08-23`

This is a sanitized read-only verification record. No provider writes,
OAuth reconnects, DNS changes, Nginx changes or deployments were performed.
The only database cleanup was removal of five temporary `example.invalid`
users/workspaces created by this verification run; provider records were not
changed.

## Baseline

- Public production: `https://mcp.holymedia.kz`
- Repository HEAD at start and end of verification: `296a15ca210e0857e645b359b5fb8d9f21ac67e8`
- Production tag: `v2-production-2026-08-23`
- V2 image: `sha-0821907...`
- Production configuration: `346ea45`
- Historical V1 commit: `c700fb7...`
- Telegram Hermes real E2E: `DEFERRED BY PROJECT DECISION`

## Inventory reconciliation

After cleanup, the production counts are unchanged from the accepted
migration baseline:

| Entity | Current V2 | Accepted baseline |
|---|---:|---:|
| Users | 11 | 11 |
| Workspaces | 11 | 11 |
| Memberships | 11 | 11 |
| Provider connections | 10 | 10 |
| Provider accounts | 191 | 191 |
| Service tokens | 12 | 12 |
| Credential envelopes | 9 | 9 |
| Workspace entitlements | 11 | 11 |
| MCP OAuth clients | 1 | 1 |

All 11 workspaces have an entitlement. All 12 service-token digests have the
expected SHA-256 shape; no duplicate digest was found. Seven tokens are
revoked and none are expired at verification time. No plaintext token was
recovered.

## Connection and account integrity

Connection inventory:

- Google Ads: 5 connections, 4 `CONNECTED`, 1 `DEGRADED`; 181 accounts and 5
  credential envelopes.
- Meta Ads: 1 `CONNECTED` connection; 1 account and 1 credential envelope.
- Google Search Console: 1 `REAUTH_REQUIRED` connection; 2 accounts and no
  credential envelope. This is an expected reauthorization state, not an
  encrypted-envelope failure.
- Yandex Direct: 2 `CONNECTED` connections; 2 accounts and 2 envelopes.
- TikTok Ads: 1 `CONNECTED` connection; 5 accounts and 1 envelope.

Structural checks over all 191 account rows:

- orphan accounts: `0`;
- workspace mismatch: `0`;
- provider mismatch: `0`;
- duplicate `(workspace, provider, external account)` bindings: `0`;
- dangling credentials: `0`;
- memberships without users/workspaces: `0`.

All 10 connection diagnostics completed without credential leakage. Google
reported four healthy connection diagnostics and one `reauth_required` health
state. Meta reported healthy. Yandex and TikTok retained their V1-compatible
credential/discovery surface; no unsupported live reporting is claimed.

## V1 archive reconciliation

The final V1 archive contains one account record for each of `meta_ads`,
`tiktok_ads` and `yandex_direct` in the legacy global connections file. Safe
external-ID set comparison against current V2 produced:

| Provider | V1 archive accounts | V2 matching IDs | V1 IDs missing from V2 |
|---|---:|---:|---:|
| Meta Ads | 1 | 0 | 1 |
| TikTok Ads | 1 | 0 | 1 |
| Yandex Direct | 1 | 1 | 0 |

The V2 records remain structurally valid and the current Meta connection is
readable, but the Meta and TikTok external IDs cannot be declared preserved
from the final V1 archive. The current V2 database also contains Google Ads
and Google Search Console state not present in that V1 archive. This requires
an operator-owned source/mapping decision before a full migration parity claim;
IDs must not be replaced automatically based on names or provider guesses.

## Provider read verification

Meta read-only smoke passed on the current V2 account: 4 campaigns, live
metrics, diagnostics healthy, 10 businesses, 1 business-account relation, 38
Pages, 2 live Page posts, 6 granted permissions and 0 missing permissions.
Foreign-account rejection, write rejection, revoked-token rejection and
expired-token rejection passed. No writes were executed.

Yandex and TikTok connection/account records and V1-compatible discovery paths
remain present. The V1 scope did not include confirmed live campaign reporting
for these providers, so no new reporting parity is asserted.

Current Google inventory is not `N/A`: five Google connections exist in V2.
One requires reauthorization according to diagnostics. The previous
`N/A - no production connection` statement is therefore stale relative to the
current database and must not be used as current provider truth.

## External contract and MCP

Compatibility smoke passed for health/readiness, unauthenticated `/mcp`, OAuth
metadata, CSRF/registration routes, Google/Meta/Yandex/TikTok callback
contracts, legacy reports and MCP-token routes. No OAuth exchange was started.

Production `/mcp` returned 140 tools using a temporary scoped audit identity.
The token was deleted immediately after the check. Representative read,
foreign-account rejection, write default-deny, revoked-token rejection and
expired-token rejection passed.

## Auth, browser and reports

Public health/dashboard shell browser smoke passed on desktop and mobile with
no client failures. A unique desktop signup/dashboard flow passed. Repeated
signup attempts from this verification IP then hit the configured abuse limit;
the current error filter serialized `RateLimitExceededError` as a generic 500
instead of 429. This is an operational error-reporting finding caused by the
test rate limit, not a migration data loss, and no production code was changed
in this verification.

Local report, billing, auth, RBAC, provider and MCP unit suites passed. The
protected production report endpoint was not exercised with a retained user
credential; no credential was created for the report check.

## Infrastructure, queues and logs

- V2 API, Web, Worker, PostgreSQL and Redis: healthy; restart count `0`.
- Redis authenticated `PONG`; BullMQ-related keys were present.
- V1 ports `8765/8766` and staging ports `18765/18766`: closed.
- Nginx V2-only; no V1 upstream references; `nginx -t` passed.
- No OOM, disk-full or recent 5xx events in the last hour.
- Historical 24-hour 5xx entries were limited to six test/rate-limit-related
  events; no provider refresh or credential-decrypt failures were found.
- Sensitive log marker scan: `0`.

## Backups and tests

Checksum and readability verification passed for:

- `/var/backups/adforge-mcp/phase-c-20260822T204959Z`;
- `/var/backups/adforge-mcp/post-cutover-v2-20260822T214700Z`;
- `/var/backups/adforge-mcp/v1-decommission-20260823T155459Z`.

Current local regression results: format, lint, typecheck and build passed;
API tests reported 56 passed and 15 skipped, with integration tests requiring
service-container credentials skipped locally. Production compatibility and
desktop/mobile shell smoke passed. Secret scan passed and dependency audit
reported no known vulnerabilities. The accepted CI workflows for commit
`296a15c...` remain green.

## Findings

1. **Blocking parity finding:** Meta and TikTok external account IDs in the
   final V1 archive do not match the current V2 records. A source/mapping
   decision is required before claiming complete V1-to-V2 account parity.
2. **Provider-state finding:** one current Google Ads connection reports
   `reauth_required`, and one Google Search Console connection has no envelope.
3. **Non-migration operational finding:** rate-limit exhaustion is returned as
   HTTP 500 instead of 429. No production code or deployment was changed.
4. Non-blocking project decisions remain Telegram Hermes E2E deferred, payment
   gateway deferred and extended Yandex/TikTok reporting out of scope.

## Verdict

**FINAL PRODUCTION PARITY NOT VERIFIED**

**V1 -> V2 account mapping requires operator reconciliation for Meta and TikTok**

Telegram Hermes real E2E remains **DEFERRED BY PROJECT DECISION**.

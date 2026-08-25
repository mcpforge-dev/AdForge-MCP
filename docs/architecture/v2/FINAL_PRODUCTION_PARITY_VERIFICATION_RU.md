# HolyMedia MCP V2 Final Production Parity Verification

Verification date: `2026-08-23`

This is a sanitized verification record. The baseline and findings sections
capture the initial read-only snapshot before parity closure; the closure
section records the narrowly scoped rate-limit deployment afterward. No
provider writes or OAuth reconnects were performed. DNS, Nginx routing and
OAuth applications were not changed. The only database cleanup was removal
of temporary verification identities/workspaces; provider records were not
changed.

## Baseline

- Public production: `https://mcp.holymedia.kz`
- Repository HEAD at initial verification snapshot: `296a15ca210e0857e645b359b5fb8d9f21ac67e8`
- Production tag: `v2-production-2026-08-23`
- V2 image: `sha-0821907...`
- Production configuration: `346ea45`
- Historical V1 commit: `c700fb7...`
- Telegram Hermes real E2E: `DEFERRED BY PROJECT DECISION`

## Inventory reconciliation

After cleanup, the production counts are unchanged from the accepted
migration baseline:

| Entity                 | Current V2 | Accepted baseline |
| ---------------------- | ---------: | ----------------: |
| Users                  |         11 |                11 |
| Workspaces             |         11 |                11 |
| Memberships            |         11 |                11 |
| Provider connections   |         10 |                10 |
| Provider accounts      |        191 |               191 |
| Service tokens         |         12 |                12 |
| Credential envelopes   |          9 |                 9 |
| Workspace entitlements |         11 |                11 |
| MCP OAuth clients      |          1 |                 1 |

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

| Provider      | V1 archive accounts | V2 matching IDs | V1 IDs missing from V2 |
| ------------- | ------------------: | --------------: | ---------------------: |
| Meta Ads      |                   1 |               0 |                      1 |
| TikTok Ads    |                   1 |               0 |                      1 |
| Yandex Direct |                   1 |               1 |                      0 |

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

## Final parity closure

This section preserves the original findings above and records the
source-of-truth reconciliation and the corrective change.

### Meta and TikTok mapping conclusion

The initial `0/1` comparison used the legacy global `connections` entries in
the V1 storage file. Those entries are not tenant-bound production
connections. The canonical V1 records are the workspace-scoped connections
under `workspaces[*].connections`, which are the records consumed by the V1
exporter and importer.

Read-only reconciliation against the final V1 archive and current V2
PostgreSQL produced:

| Provider      | Canonical V1 workspace-scoped rows | V2 rows | Exact canonical external-ID matches | Missing | Classification                  |
| ------------- | ---------------------------------: | ------: | ----------------------------------: | ------: | ------------------------------- |
| Meta Ads      |                                  1 |       1 |                                   1 |       0 | `MATCH - SAME PROVIDER ACCOUNT` |
| TikTok Ads    |                                  5 |       5 |                                   5 |       0 | `MATCH - SAME PROVIDER ACCOUNT` |
| Yandex Direct |                                  2 |       2 |                         1 unique ID |       0 | `MATCH - SAME PROVIDER ACCOUNT` |

Meta was compared as the Meta ad-account identifier, including the canonical
`act_<id>` representation. It was not compared against Business, Page or
Instagram identifiers. TikTok `account_id` and `advertiser_id` were present
and equal in every canonical V1 row; V2 `externalAccountId` uses the same
19-digit advertiser identity. Workspace ownership, connection context,
names/statuses and account counts reconcile, with no provider account loss.

The unmatched legacy global Meta/TikTok rows are unscoped legacy records and
are not evidence of a lost tenant-bound advertising account. No production
provider data was changed.

### Google classification

The final V1 archive does contain Google Ads workspace-scoped data: 5
connections, 181 account rows and 111 unique customer IDs. All canonical V1
rows were `connected` and had encrypted credential envelopes. V2 contains the
same 5 connections, 181 rows and 111 unique customer IDs; the exact customer
ID set and credential-envelope presence reconcile. Therefore the earlier
`N/A - no production connection` statement was an inventory error, not a
credential-migration result.

The historical `REAUTH_REQUIRED` interpretation is **Category A: NOT A
MIGRATION REGRESSION - CONNECTION WAS ALREADY STALE/REAUTH_REQUIRED**. The
current persisted Google Ads state is one `DEGRADED/provider_response_invalid`
connection and four healthy connections, not a missing-envelope state. The
degraded connection contains a legacy mixed manager/customer hierarchy with
provider-side `CANCELED`/`CLOSED` account states; V1 has no successful-read
telemetry or last-success evidence for that archived connection. No V1
working credential was demonstrated to have been lost by migration, and no
reauthorization was performed. Google Search Console remains **Category B:
NOT A PRODUCTION CAPABILITY - INCOMPLETE/LEGACY CONNECTION** because it is
absent from the final V1 archive and has no V2 credential envelope.

### Rate-limit closure

The shared `RateLimitExceededError` is now mapped centrally by
`ApiExceptionFilter` to HTTP `429`, error code `rate_limited` and the
sanitized message `Too many requests.`. No `Retry-After` header is emitted
because the current limiter does not expose a reliable remaining-window
value. Ordinary client errors remain `400/request_invalid`, and unexpected
errors remain `500/internal_error`.

Regression coverage exercises the shared signup/login rate-limit mapping,
the generic exception mapping and the ordinary unexpected-error path. A
controlled production verification confirmed `429` on the configured public
endpoint without creating accounts or provider writes.

### Post-deploy verification

The rate-limit fix was built by the existing GitHub Actions production-image
workflow and deployed as immutable image
`ghcr.io/mcpforge-dev/holymedia-mcp-v2:sha-82e4d22ac4f00cd9faacff6dacf0b3907fb29f1f`.
Only the API/worker/web image reference changed; DNS, Nginx routing, OAuth
applications, callback URLs, database records and provider data were not
changed.

Post-deploy public checks passed:

- `/health`: `200`;
- `/ready`: `200` with PostgreSQL and Redis dependencies healthy;
- `/mcp` without a token: `401`;
- all V2 PostgreSQL, Redis, API, Worker and Web containers: healthy;
- no temporary closure identities or tokens remained: `0`.

The controlled login rate-limit smoke used the existing V2 route with an
invalid email/password and did not create an account. It observed `401` for
the allowed attempts and `429` after the configured threshold; no `500` was
returned for the rate-limit condition. Meta read-only smoke passed with 4
campaigns, healthy diagnostics and 10 businesses. Yandex and TikTok
V1-compatible account discovery, account status and diagnostics returned
successful responses without provider errors. No provider writes were
executed.

GitHub Actions run IDs for commit `82e4d22...` were all successful: foundation
`32654754916`, full-stack Compose `32654754814`, production image
`32654754876` and browser/compatibility E2E `32654754869`. Local format,
lint, typecheck, build, API tests (`60 passed`, `15 skipped` for unavailable
local service containers), secret scan and dependency audit passed. Critical
findings remain `0`; High findings remain `0`.

### Closure status

The original Meta/TikTok mapping finding is closed as a source-selection
error, the Google signal is classified as provider/legacy state rather than a
proven migration loss, and the rate-limit serialization defect is fixed in
code with regression coverage. Final production verification remains
confirmed by the post-deploy controlled `429` smoke and the green CI/image
promotion checks.

## Final verdict

**FINAL PRODUCTION PARITY VERIFIED**

**NO UNRESOLVED V1 -> V2 MIGRATION REGRESSIONS**

Meta and TikTok canonical workspace-scoped provider accounts were not lost;
the earlier mismatch was caused by comparing unscoped legacy global records.
Google Ads customer IDs and encrypted credential-envelope presence reconcile;
the one degraded hierarchy is classified as legacy/provider state, while
Google Search Console remains an incomplete legacy connection outside the V1
production capability set.

**TELEGRAM HERMES REAL E2E - DEFERRED BY PROJECT DECISION**

## Reports production closure

### Finding, investigation and resolution

The Reports failure was not an account-selection loss. `ProviderAccount.enabled`
and the atomic selection endpoint correctly persisted the selected Google Ads
account. The report routes, however, used a type-only DTO import with Nest's
strict query validation, so a valid query could reach the controller as
`400/request_invalid`. Commit `ef8c464` supplies the runtime DTO explicitly
to the validation pipe and adds regression coverage.

During the investigation one Google connection was temporarily reported as
`DEGRADED` with a sanitized provider authentication error. Read-only V1/V2
comparison confirmed that the historical Google OAuth client, public callback
`/oauth/google/callback`, Google Ads scope, offline access, consent and
granted-scope behavior are identical. The Google hierarchy metadata repair in
`8c127ed` restored the V1-compatible manager/customer context without
changing credentials, account IDs or enabled selections. The existing
credential subsequently refreshed successfully; no Google reauthorization,
new OAuth application or callback change was required.

Commit `3771f44` preserves sanitized refresh-failure classification and makes
Reports distinguish an unselected account from a connection that genuinely
needs reauthorization. The UI now directs the user to Connections for the
latter state instead of incorrectly saying that no account was selected.

### Controlled production verification

The deployed image
`ghcr.io/stanforge-labs/holymedia-mcp-v2:sha-3771f44f57d81deb4482cdb331835f1b543c9141`
was verified through a temporary, authenticated, headless Playwright smoke
using an existing production user. It performed no provider writes and
restored the original account selection afterwards.

- Google OAuth-start contract contained the historical callback, Google Ads
  scope, offline access, consent, granted-scope preservation and a state
  value; the external callback contract was not changed.
- The existing Google connection was `CONNECTED`; credential, provider and
  selected-account health checks all succeeded.
- One real Google account was selected through the atomic batch endpoint,
  persisted after a reload, and appeared in the Reports selector.
- Performance preview returned `realData=true`; DOCX generation returned
  valid DOCX payloads with real provider data for 7-, 14- and 30-day periods.
  The report engine therefore received the requested date ranges rather than
  using a placeholder or a hard-coded period.
- Public `/health` and `/ready` returned `200`; public `/mcp` without a token
  returned `401`.

The production inventory currently contains 276 provider-account records with
zero orphan rows, zero cross-workspace bindings and zero unexpected duplicate
provider bindings. The user used for the controlled Google smoke has no Meta
connection in any of their workspaces. A separate Meta connection is
`CONNECTED` in production, but its workspace is not accessible to that user;
an authenticated Meta DOCX request was intentionally not attempted because it
would bypass tenant isolation. This is not evidence of a Reports regression.

GitHub Actions for `3771f44` passed foundation, production image, full-stack
Compose and browser/compatibility workflows. Critical findings remain `0` and
High findings remain `0`.

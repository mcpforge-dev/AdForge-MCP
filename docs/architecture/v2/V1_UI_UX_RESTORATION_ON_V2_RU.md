# V1 UI/UX restoration on V2

## Source of truth

The visual and interaction reference is the last production V1 frontend at
commit `c700fb7`, especially `src/ad_mcp/web/static/index.html`,
`src/ad_mcp/web/static/app.css` and `src/ad_mcp/web/static/app.js`.
V2 keeps its Next.js runtime, V2 API routes, CSRF/session security, workspace
authorization, provider contracts and database unchanged.

## Parity matrix

| Area              | V1 behavior/design                                                            | V2 before restoration                                   | Restored on V2                                                                  |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Landing           | Product-first dark landing, three steps, AI example and safety copy           | Minimal two-column marketing page                       | V1-like landing hierarchy, copy, CTA and responsive sections                    |
| Header            | Brand, login/register actions and compact navigation                          | Basic public header                                     | Same compact brand/navigation treatment                                         |
| Auth              | Focused dark card, tabs, Google entry, email login, registration and reset    | Functional card with mojibake copy and weaker hierarchy | V1-like card, clean Russian copy, tabs, Google/email/reset flow                 |
| Dashboard         | Tabbed workspace shell with overview, connections, MCP, reports and profile   | Long technical page with every panel visible            | Tabbed shell and progressive disclosure                                         |
| Workspace         | Workspace selector, members, roles and invite flow                            | Same API behavior but visually exposed as admin form    | V1-like workspace section using V2 RBAC endpoints                               |
| Connections       | Provider cards, OAuth action, account discovery and selection                 | Functional provider list in one long page               | Provider tab, status badges, account selector, read smoke and reconnect actions |
| Account selection | Checkbox selection, readable names/statuses, explicit save-by-toggle behavior | Same endpoint but weak scanning layout                  | Dense account rows with workspace-scoped selection and clear states             |
| MCP onboarding    | URL, token creation, account scope and AI-client guidance                     | Technical token form                                    | Three-step onboarding and one-time secret presentation                          |
| Service tokens    | Create, copy once, rotate, revoke and show status                             | Functional but buried in page                           | Dedicated AI-client section with same V2 security behavior                      |
| Reports           | Account/period selection, generate/download and client-oriented preview       | DOCX action embedded beside provider accounts           | Dedicated reports section with account picker and preview                       |
| Profile           | User-facing name/email and password actions                                   | No clear user-facing profile surface                    | Profile and password forms over `/api/profile` and V2 auth endpoint             |
| Billing           | Not present in V1                                                             | V2-only foundation exposed as a technical panel         | Kept as a separate V1-style workspace tab without changing billing APIs         |
| Analytics         | Not present as a client feature in V1                                         | V2-only admin foundation                                | Kept out of the main onboarding path and available to OWNER/ADMIN               |
| Mobile            | Stacked cards, readable actions and no horizontal page overflow               | Basic responsive stacking                               | V1-like stacked navigation, forms, cards and hit areas                          |

## Deliberately not restored

The V1 storage, authentication implementation, provider calls, plaintext token
handling and legacy backend routes were not returned. The old V1 render is
kept only as an internal code fallback while the default V2 render uses the
V2 contracts. Provider credentials, connections, account IDs, service-token
digests and entitlements are not modified by this change.

## Verification

- Historical source: V1 commit `c700fb7`; the V2 presentation layer was
  restored without reverting the V2 backend, auth, provider or storage
  architecture. The implementation commit is `020bccb5`.
- The final CI chain for the deployed code is green: foundation, PostgreSQL /
  Redis and Compose smoke, Playwright desktop/mobile E2E, and the immutable
  production image workflow. The final deployed code commit is
  `1900d901fbb56f888c295e263df2dee812af6644`.
- Production image deployed: `ghcr.io/mcpforge-dev/holymedia-mcp-v2:sha-1900d901fbb56f888c295e263df2dee812af6644`.
- Post-deploy public smoke passed on desktop and mobile for the public landing
  and auth shell. Production `/health` and `/ready` return `200`; `/mcp`
  without authentication returns `401`. Authenticated dashboard flows passed
  in the isolated Playwright CI environment, with no production test data
  created.
- Production V2 containers (API, Web, Worker, PostgreSQL and Redis) are
  healthy. Nginx, DNS, OAuth applications and callback URLs were not changed.
- Read-only integrity check after deployment: 11 users, 11 workspaces, 11
  memberships, 10 connections, 191 provider accounts, 12 service tokens and
  11 entitlements; orphan accounts, cross-tenant mismatches and duplicate
  bindings are all `0`.
- The current production database and the pre-deploy UI backup both contain 8
  provider credential rows. The previously quoted count of 9 was a stale
  baseline discrepancy; the UI deployment did not change credentials or
  provider data.
- No provider writes, reconnects, account-ID changes or migration actions were
  performed during the UI restoration.

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

- V2 web lint, typecheck and production build pass locally.
- Playwright coverage was updated for the restored tabbed flows: landing,
  auth, dashboard, workspace creation, connections, MCP, reports and billing.
- Desktop/mobile screenshot evidence was captured locally for landing and auth
  without user, workspace, provider or token data.
- Production deployment remains a separate step after full CI approval.

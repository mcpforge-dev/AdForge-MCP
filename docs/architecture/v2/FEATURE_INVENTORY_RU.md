# Feature Inventory и parity baseline

Статус: `implemented` означает подтверждённый кодом/тестами сценарий, `partial` — рабочая часть с ограничением, `planned` — целевой v2 scope, а не обещание текущего MVP.

| Область | v1 status | Evidence / limitation | v2 target |
|---|---|---|---|
| Публичный web | partial | static frontend + custom Python handler | Next.js SSR/SSG/ISR |
| Регистрация/login/logout | implemented | `web/server.py`, `auth_store.py`, unit tests | Identity module + session store |
| Password reset | implemented | hashed one-time token and TTL tests | transactional email + abuse controls |
| Users/workspaces | partial | owner workspace created; oldest workspace selected | explicit active workspace and memberships |
| RBAC | partial | membership exists, role model narrow | policy-based RBAC/permissions |
| Tenant isolation | partial/strongening | workspace context and tests; no FK/RLS | server policy + FK + optional RLS |
| Google Ads OAuth/read | implemented | live adapter, reports, account discovery | provider contract + worker-backed reads |
| Meta Ads OAuth/read | implemented | Ads/Business/Page/Graph reads; permissions depend on Meta | adapter contract + typed capabilities |
| Meta write | guarded partial | preview/confirmation code; live global preview-only | policy/preview/commit/reread/audit |
| Yandex Direct | partial | provider exists; reporting preview/placeholder | real adapter or explicitly unavailable capability |
| TikTok Ads | partial | provider exists; reporting preview/placeholder | real adapter or explicitly unavailable capability |
| Account selection | implemented | workspace-scoped selected accounts and merge/add flow | normalized account relation with constraints |
| MCP HTTP | implemented | FastMCP + bearer auth; unauthenticated endpoint 401 | versioned MCP gateway + policy engine |
| Service tokens | partial | hashed token, scope and account allowlist | expiry, rotation, revocation, audit |
| Dynamic MCP OAuth | partial | PKCE S256 and one-time codes; provider OAuth paths differ | unified OAuth broker + PKCE where supported |
| Reports | implemented/partial | Google/Meta data and DOCX/PDF exports; synchronous generation | async report jobs, templates, artifact storage |
| Site analysis | partial | Playwright/HTML/image analysis and report export | isolated worker, quotas, evidence pipeline |
| SEO/Search Console | partial | provider code/UI history exists; hidden/limited product state | dedicated SEO module and property isolation |
| Hermes/Telegram | absent here | no `src/hermes*` or Telegram bot runtime in this repo | separate app using scoped service API |
| Billing/plans | absent | no billing tables or provider abstraction | Billing domain and payment adapter contract |
| Product analytics | partial/absent | audit_events exists; no event pipeline/warehouse | privacy-safe event schema and ingestion |
| Admin | partial | admin session guards/manual onboarding | explicit admin app and permissions |
| Notifications | absent | no notification domain/queue | notification service/module |
| Background jobs | absent | reports/external calls in HTTP request path | Redis/BullMQ workers |
| Observability | partial | request IDs and redacted errors; no OTel pipeline | logs, metrics, traces, error tracking |
| CI/CD | absent | no `.github` workflow found | gated CI + staged deploy/rollback |

## Parity rule

В v2 нельзя считать provider готовым по наличию класса. Provider считается migrated только если есть contract tests, real-data smoke в staging, permission/error mapping, pagination, rate-limit/retry policy, audit and tenant-isolation tests.


# Feature inventory и parity baseline

Статусы отражают фактическое состояние branch `v2/phase-a-complete-product`.

| Область | Статус | Текущее подтверждение | Остаток для Phase A |
|---|---|---|---|
| Public web/SEO | partial | Next.js App Router, metadata, legal pages, noindex private routes | полноценные публичные страницы, sitemap/robots/JSON-LD и redirect policy |
| Регистрация/login/logout | implemented | Argon2id, opaque sessions, CSRF, password reset foundation, Google Login compatibility | E2E и email delivery adapter |
| Users/workspaces/RBAC | implemented | memberships, OWNER/ADMIN/MEMBER/VIEWER, server guards, tenant tests | UI role management parity |
| Provider connections | implemented/partial | generic OAuth/state/PKCE/vault, Google/Meta real adapters, Yandex/TikTok boundaries | live parity and worker sync |
| Google Ads | implemented/partial | OAuth, refresh, hierarchy discovery, campaigns, metrics, health | live V2 read verification and edge-case parity |
| Meta Ads | implemented/partial | OAuth permissions, accounts/campaigns/metrics, Business/Page/posts/Instagram | live V2 verification, missing-permission UX, write adapter |
| Yandex Direct | partial | OAuth/discovery boundary | real read adapter or explicit unavailable capability |
| TikTok Ads | partial | OAuth/discovery boundary | real read adapter or explicit unavailable capability |
| Account selection | implemented | workspace-scoped enable/disable, multi-account add flow and account allowlists | reconnect preservation E2E |
| MCP HTTP | implemented | `/mcp`, JSON-RPC initialize/tools/list/tools/call, 401 without bearer | protocol conformance and richer error contract |
| Service tokens | implemented/partial | hash-at-rest, scopes, expiry, revoke, last-used, account restrictions, creator binding | rotation API and migration rehearsal |
| MCP read analytics | implemented | performance, comparison, executive/status/top performers, skill routes | detailed entity reports |
| MCP write policy | guarded partial | preview, confirmation, one-time commit attempt, read/write scope gate, writes blocked | provider mutation adapters and controlled allowlist |
| Reports | implemented/partial | performance report and DOCX, monthly collect-report compatibility | branded template, async artifacts, PDF parity |
| Site analysis | implemented/partial | SSRF-hardened live HTML analysis, workspace history, DOCX export | evidence pipeline and richer UX/report |
| SEO/Search Console | implemented/partial | OAuth adapter, properties, analytics report, MCP tools | full client dashboard and export parity |
| Hermes | implemented foundation | separate read-only Telegram gateway, deterministic Russian analytics, scoped service identity, chat/account allowlists, optional AI boundary and safe startup validation | production deployment wiring and final V1 scenario sign-off |
| Billing/plans | implemented foundation | plans/prices/subscriptions/orders/attempts/usage/entitlements, read API, payment port, server-side report/account/MCP entitlement and quota enforcement, legacy migration entitlement | concrete checkout/webhook adapter waits for payment-provider selection |
| Product analytics | implemented | workspace-scoped allowlisted events, scalar-only redacted properties, aggregated admin summary, audit and provider metrics remain separate | external BI/export adapter is optional post-parity work |
| Admin | implemented/partial | workspace-scoped user/status/role/diagnostics, self-service OAuth, manual request UI and least-privilege support grant | full admin UI and end-to-end specialist handoff |
| Background jobs | foundation | BullMQ, retry/graceful shutdown, discovery queue boundary | actual provider discovery/health jobs |
| Observability | foundation | structured logs, request IDs, safe errors, provider metrics | OTel exporter, dashboards and alerting |

## Rules

- An adapter class alone is not parity.
- Any provider data returned to a client must carry source/provenance and must
  not be a fixture presented as live data.
- Any user, connection, account, service token or report lookup is scoped by
  workspace on the server.
- Unsupported tools are not registered as fake success responses.
- Production V1, its database, DNS and OAuth applications are unchanged while
  Phase A is being developed.

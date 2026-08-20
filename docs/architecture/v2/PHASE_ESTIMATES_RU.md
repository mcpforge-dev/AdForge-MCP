# Estimated phases

Estimates are engineering effort ranges for a small senior team, not calendar promises. They exclude provider approval delays and client-side OAuth actions.

| Phase | Scope | Estimate |
|---|---|---:|
| 0 | audit and decisions | completed in this task |
| 1 | monorepo, contracts, Docker, CI, migrations | 1.5-2.5 weeks |
| 2 | identity, tenancy, RBAC, sessions | 2-3 weeks |
| 3 | provider framework, OAuth, encrypted credentials | 2-3 weeks |
| 4 | Google/Meta read parity | 3-5 weeks |
| 5 | MCP tokens and safe writes | 2-3 weeks |
| 6 | Hermes boundary and Telegram parity | 1.5-3 weeks after source location |
| 7 | web/SEO/dashboard/reports/jobs | 3-5 weeks |
| 8 | billing/entitlements/payments abstraction | 2-4 weeks |
| 9 | analytics/observability/admin/notifications | 2-3 weeks |
| 10 | migration rehearsal and parity | 2-4 weeks |
| 11-12 | QA/security/performance/soak | 2-4 weeks |
| 13 | controlled production cutover | 1-2 weeks including observation |

## Critical path

Foundation -> tenancy/security -> encrypted OAuth/provider framework -> read parity -> MCP safe writes -> report/jobs -> migration rehearsal -> soak. Billing can be built in parallel after shared identity/usage contracts exist, but must not be coupled directly to provider adapters.

## Stop criteria before Phase 1

- architecture and ORM decision approved;
- Hermes source/repository ownership identified;
- production backup/restore owner and procedure agreed;
- provider OAuth client/callback policy agreed for dev/staging/production;
- decision on whether v2 is a new repository or a monorepo alongside v1;
- no production cutover commitment before parity matrix is green.


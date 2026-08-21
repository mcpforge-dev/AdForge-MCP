# HolyMedia MCP V1 → V2: Phase B parity report

Статус этого документа — рабочая сверка перед migration rehearsal. `LIVE_READ_VERIFIED` и `E2E_VERIFIED` нельзя выставлять по fixture-тесту: для них нужен отдельный защищённый запуск на том же provider connection и периоде.

| V1 capability                                    | V2 equivalent                                               | Status              | Evidence / remaining gate                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Регистрация, login, logout, reset                | `apps/api/src/auth/*`, legacy auth controllers              | IMPLEMENTED         | V1 PBKDF2 transitional verify + Argon2id rehash; real migrated-user test requires rehearsal DB                          |
| Users / workspaces / memberships                 | Prisma identity schema and workspace services               | IMPLEMENTED         | FK, owner invariant, tenant tests                                                                                       |
| Roles / permissions                              | RBAC guard and permission service                           | IMPLEMENTED         | matrix tests in API suite                                                                                               |
| Google Ads OAuth                                 | V2 Google adapter + `/oauth/google/callback`                | CODE_COMPLETE       | live refresh/discovery/read parity pending protected provider run                                                       |
| Google hierarchy / campaigns / metrics           | V2 Google read adapter                                      | CODE_COMPLETE       | sanitized contract tests; real V1/V2 same-account comparison pending                                                    |
| Meta OAuth / permissions                         | V2 Meta adapter + `/oauth/meta/callback`                    | CODE_COMPLETE       | requested/granted/missing scopes are preserved; fresh or migrated token read pending                                    |
| Meta accounts / Business / Pages / Instagram     | V2 Meta read adapter                                        | CODE_COMPLETE       | Graph API contract tests; real Page/posts/Instagram read pending                                                        |
| Yandex OAuth/discovery                           | V2 Yandex adapter boundary                                  | PARTIAL_BY_DESIGN   | V1 had OAuth/discovery boundary; no verified reporting parity to claim                                                  |
| TikTok OAuth/discovery                           | V2 TikTok adapter boundary                                  | PARTIAL_BY_DESIGN   | V1 had OAuth/discovery boundary; no verified reporting parity to claim                                                  |
| Provider account selection                       | `ProviderAccount.enabled` and provider API                  | IMPLEMENTED         | server-side workspace/account scope tests                                                                               |
| MCP public transport `/mcp`                      | V2 MCP controller + compatibility path                      | IMPLEMENTED         | read auth and OAuth metadata covered; live client smoke pending                                                         |
| MCP tool names                                   | V2 registry includes V1 names plus V2 aliases               | COMPATIBILITY_ALIAS | names alone are not parity; unsupported/partial tool behavior is documented in `FEATURE_INVENTORY_RU.md`                |
| Read metrics / campaigns / diagnostics           | normalized provider read methods                            | IMPLEMENTED         | local contract tests; live provider parity pending                                                                      |
| Preview → confirmation → commit → reread → audit | `McpPreviewService` and controlled Meta mutation adapter    | CONTROLLED_WRITE    | default disabled; no production mutation in Phase B                                                                     |
| Service tokens                                   | hashed `ServiceToken` + identity/scope/account restrictions | IMPLEMENTED         | SHA-256 digest compatible with V1; source plaintext is never needed                                                     |
| Performance report JSON/DOCX                     | V2 reports module and legacy report routes                  | IMPLEMENTED         | KPI set, comparison and evidence-based insights; PDF/detailed provider reports are not V1-equivalent unless live-tested |
| Site analysis                                    | V2 site-analysis service/controller                         | IMPLEMENTED         | SSRF validation and artifact access tests                                                                               |
| SEO / Search Console                             | V2 Search Console controller/adapter                        | IMPLEMENTED         | property selection and report contract; live OAuth read pending                                                         |
| Hermes Telegram gateway                          | `apps/hermes` scoped MCP consumer                           | CODE_COMPLETE       | deterministic fallback tests; real Telegram → V2 provider E2E pending                                                   |
| Dashboard / profile / manual Meta request        | V2 web + compatibility controllers                          | IMPLEMENTED         | browser E2E and mobile visual QA remain a Phase B gate                                                                  |
| Billing / entitlements                           | V2 billing foundation + legacy entitlement                  | NEW_V2              | V1 had no billing behavior; migration must grant legacy/internal entitlement                                            |
| Product analytics / admin diagnostics            | V2 privacy-safe analytics and admin facade                  | NEW_V2              | production event-volume and admin E2E pending                                                                           |

## Interpretation

- `IMPLEMENTED` means code and automated tests exist, not that a live provider result was fabricated.
- `CODE_COMPLETE` means adapter and contract behavior is present; the live connection still needs a controlled read-only verification.
- `PARTIAL_BY_DESIGN` is intentional where V1 had no confirmed report behavior.
- Phase B acceptance cannot be honest until migration copy, live read parity, route smoke, Hermes E2E, backup/restore and CI results are recorded.

# Матрица parity v1 → v2: Google Ads и Meta Ads

Статусы: `NOT_STARTED`, `IMPLEMENTED`, `TESTED`, `LIVE_READ_VERIFIED`, `PARITY_CONFIRMED`.
Фикстуры являются sanitized и не считаются live-проверкой.

| Возможность                         | v1 reference                                     | v2 implementation                                                           | Статус      | Проверка                                     |
| ----------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| Google OAuth Authorization Code     | `src/ad_mcp/web/partner_oauth.py`                | `apps/api/src/providers/adapters/google.ads.ts` через Phase 3 orchestration | TESTED      | OAuth URL contract                           |
| Google token exchange/refresh       | `src/ad_mcp/web/partner_oauth.py`                | Google OAuth adapter                                                        | TESTED      | safe token response mapping                  |
| Google accessible customers         | `partner_oauth.py`                               | `customers:listAccessibleCustomers`                                         | TESTED      | sanitized adapter test                       |
| Google manager/customer hierarchy   | `partner_oauth.py`, `google_ads/account_read.py` | `customer_client` GAQL, login customer header                               | TESTED      | hierarchy fixture                            |
| Google campaign read                | `google_ads/account_read.py`                     | Google Ads REST `searchStream`                                              | TESTED      | campaign normalization fixture               |
| Google metrics                      | `google_ads/reporting.py`                        | normalized account/campaign metrics                                         | TESTED      | micros/derived metrics tests                 |
| Google diagnostics/health           | `web/diagnostics.py`                             | lightweight account health read                                             | TESTED      | adapter contract                             |
| Meta OAuth and granted permissions  | `web/meta_oauth.py`                              | Meta OAuth adapter + `/me/permissions`                                      | TESTED      | scope contract                               |
| Meta ad account discovery           | `meta_ads/graph_read.py`                         | `/me/adaccounts`                                                            | TESTED      | sanitized account fixture                    |
| Meta Business discovery             | `meta_ads/graph_read.py`                         | `/me/businesses`                                                            | IMPLEMENTED | sanitized contract; live read pending        |
| Meta Pages                          | `meta_ads/graph_read.py`                         | `/me/accounts`                                                              | TESTED      | page fixture                                 |
| Page posts and engagement           | `meta_ads/graph_read.py`                         | Page Access Token + `/{page}/published_posts`                               | TESTED      | page posts fixture                           |
| Page → Instagram                    | `meta_ads/graph_read.py`                         | `/{page}?fields=instagram_business_account`                                 | TESTED      | page/Instagram fixture                       |
| Meta campaigns                      | `meta_ads/account_read.py`                       | `/{ad-account}/campaigns`                                                   | IMPLEMENTED | sanitized contract; live read pending        |
| Meta metrics                        | `meta_ads/analysis.py`                           | `/{ad-account}/insights`                                                    | IMPLEMENTED | sanitized contract; live read pending        |
| Provider-neutral read API           | Phase 3 contracts                                | summary/campaigns/metrics/health routes                                     | IMPLEMENTED | typecheck + API security review              |
| Tenant isolation                    | Phase 2/3                                        | workspace + connection + selected account server checks                     | TESTED      | existing integration + route guards          |
| Production live read                | v1 live credentials                              | optional env-only smoke                                                     | NOT_STARTED | intentionally pending, no credentials copied |
| Yandex OAuth / account discovery    | `web/partner_oauth.py`                           | `adapters/yandex.direct.ts`                                                 | TESTED      | OAuth and clients contract                   |
| TikTok OAuth / advertiser discovery | `web/partner_oauth.py`                           | `adapters/tiktok.ads.ts`                                                    | TESTED      | OAuth and advertisers contract               |

V1 Yandex/TikTok campaign reporting was preview/seeded provider output rather
than verified live reads. V2 deliberately does not label those shapes as live
provider parity. Real campaign and metrics adapters remain a future provider
capability and are not a cutover regression from a confirmed V1 live read.

Phase 4 baseline не переносил MCP/Hermes и не открывал широкие provider writes. В текущем Phase A добавлена серверная controlled Meta mutation boundary: по умолчанию включён `preview_only`, а commit требует отдельного confirmed-write флага, read/write scope и account/object/operation allowlists. Это не считается live-write verification.

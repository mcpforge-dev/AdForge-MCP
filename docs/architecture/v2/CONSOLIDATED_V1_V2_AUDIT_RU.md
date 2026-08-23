# HolyMedia MCP V1 → V2: consolidated audit

**Дата среза:** 22 августа 2026 года  
**Ветка:** `feat/install-memora`  
**Кодовый baseline Phase B:** `a3780891680ee18edea7222d111d9fc47769a13f`  
**Назначение:** итоговый аудит перед Phase C. Документ не выполняет миграцию, deploy, переключение Nginx или изменение V1.

## 1. Executive summary

V1 — рабочий Python-продукт с legacy auth, файловым/JSON-хранилищем, provider-логикой Google/Meta и MCP HTTP-контуром. V2 — параллельная modular-monolith реализация на TypeScript с отдельными web, API, worker и Hermes runtime, PostgreSQL/Prisma, Redis/BullMQ и серверной моделью авторизации.

Основное ядро V2 уже способно заменить V1 по identity, tenant isolation, миграции данных, MCP read-контракту и проверенным Google/Meta read-сценариям. Это ещё не 100% функциональный drop-in replacement: Yandex/TikTok не имеют подтверждённого live reporting parity, часть старых имен инструментов остаётся честным `unsupported` alias, не завершены browser E2E, настоящий Telegram E2E и smoke конкретного сохранённого production service token.

**Production readiness: 95%.** Основные pre-cutover проверки закрыты. Real Telegram/Hermes E2E зафиксирован как `DEFERRED BY PROJECT DECISION` и не является условием текущего cutover по решению владельца проекта.

**Текущий verdict: PHASE B ACCEPTED FOR PRODUCTION CUTOVER — TELEGRAM E2E DEFERRED BY PROJECT DECISION.**

## 2. Новый стек

| Компонент                   |                                Фактическая версия | Назначение                              | Что заменяет                          |
| --------------------------- | ------------------------------------------------: | --------------------------------------- | ------------------------------------- |
| Node.js                     |                         24 LTS range (`>=24 <25`) | runtime всех V2 приложений              | Python runtime отдельных V1 процессов |
| TypeScript                  |                                             6.0.3 | строгий application code                | Python/JS без единого typed contract  |
| Next.js                     |                                            16.3.1 | SSR/SSG/ISR web и dashboard             | V1 frontend/static routes             |
| React                       |                                            19.2.8 | web UI                                  | V1 UI                                 |
| NestJS                      |                                            11.2.1 | модульный API                           | V1 Python HTTP backend                |
| Fastify                     |                                            5.11.3 | HTTP adapter, limits и security headers | V1 HTTP server                        |
| PostgreSQL                  |               18 (`postgres:18-alpine` в Compose) | transactional multi-tenant data         | V1 JSON/file storage                  |
| Prisma                      |                                             7.9.1 | typed database layer и migrations       | V1 ручной storage layer               |
| Redis                       |                         7.4 (`7.4.6` в rehearsal) | distributed limits, locks и queues      | V1 process-local coordination         |
| BullMQ                      |                                             6.1.2 | worker jobs, retry, deduplication       | V1 synchronous/background fragments   |
| pnpm                        |                                            11.1.3 | workspace package manager               | V1 requirements/pip workflow          |
| Turborepo                   |                                           2.10.11 | monorepo build/test orchestration       | V1 разрозненные сборки                |
| Vitest                      |                                            4.1.11 | V2 unit/integration tests               | V1 pytest only                        |
| Prisma PostgreSQL adapter   |                                             7.9.1 | DB connectivity                         | V1 direct file/database access        |
| Docker Compose              |                                  Compose V2 files | reproducible local/full-stack runtime   | V1 VPS-only deployment shape          |
| GitHub Actions              |           V2 foundation и compose smoke workflows | CI, services, migrations, scans         | V1 менее формализованный CI           |
| Structured logs/request IDs |                          V2 observability package | correlation и безопасная диагностика    | V1 разрозненные logs                  |
| Secret/dependency scans     | built-in CI scripts, `pip check`/dependency audit | leakage и dependency controls           | V1 manual checks                      |

## 3. Архитектура V1 → V2

### V1

- Python backend и legacy API;
- JSON/file storage и legacy connection records;
- legacy auth/session model;
- provider implementations и MCP tools в существующем V1 runtime;
- frontend и VPS/reverse-proxy deployment;
- Hermes source в актуальной кодовой базе не найден и не мигрировался.

### V2

- `apps/web` — Next.js public/private web;
- `apps/api` — NestJS/Fastify REST, OAuth, providers, MCP, auth, billing и admin;
- `apps/worker` — BullMQ jobs вне HTTP lifecycle;
- `apps/hermes` — отдельный Telegram runtime с scoped service identity;
- `packages/contracts`, `database`, `config`, `observability`, `testing`;
- PostgreSQL/Prisma как source of truth;
- Redis/BullMQ для distributed coordination и фоновых задач.

Физическое разделение runtime не превращает продукт в microservices: это modular monolith с отдельными процессами, границами модулей и возможностью последующего выноса тяжёлого компонента.

## 4. Что переписано и что добавлено

| V1                               | V2                                                                           | Статус                |
| -------------------------------- | ---------------------------------------------------------------------------- | --------------------- |
| Legacy auth/session              | Argon2id, opaque server sessions, CSRF, transitional PBKDF2 login            | Переписано            |
| Users/workspaces/RBAC            | PostgreSQL entities, memberships, guards, policies                           | Переписано            |
| Provider connection records      | generic ProviderConnection/Account/Credential model                          | Переписано            |
| Plain/legacy credential handling | AES-256-GCM vault, versioned envelopes, rotation path                        | Переписано            |
| Google Ads integration           | OAuth, refresh, hierarchy, campaigns, metrics, diagnostics                   | Перенесено в adapter  |
| Meta Ads integration             | permissions, ad accounts, campaigns, insights, Business/Page/Instagram       | Перенесено в adapter  |
| Yandex/TikTok boundaries         | provider registry, OAuth/discovery foundation                                | Частично перенесено   |
| MCP HTTP/tools                   | `/mcp`, bearer service identities, compatibility registry, read/write policy | Переписано совместимо |
| Service tokens                   | hashed token, scopes, workspace/account limits, expiry/revoke/rotate         | Переписано            |
| Reports                          | KPI, comparisons, DOCX, evidence/provenance                                  | Расширено             |
| Hermes                           | clean V2 implementation, Telegram adapter, deterministic fallback            | Новая реализация      |
| Dashboard                        | Next.js auth/workspace/connections/provider/admin/billing surfaces           | Новая реализация      |
| Billing                          | plans, entitlements, usage, payment abstraction                              | Новая V2 функция      |
| Analytics/observability          | privacy-safe events, audit, request IDs, provider metrics                    | Новая V2 функция      |

Не все V1 имена инструментов означают отдельную полноценную capability: неподдержанные старые операции возвращают явный `unsupported`, а не fixture или ложный успех.

## 5. Сохранённый внешний контракт

| Контракт                                                                    | Статус                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `mcp.holymedia.kz`                                                          | `UNCHANGED` — ожидаемый hostname                                  |
| DNS/TLS/reverse proxy                                                       | `UNCHANGED` до Phase C                                            |
| Google application и `/oauth/google/callback`                               | `UNCHANGED` / compatibility route                                 |
| Meta application и `/oauth/meta/callback`                                   | `UNCHANGED` / compatibility route                                 |
| Yandex `/oauth/yandex/callback`                                             | `UNCHANGED` / compatibility route                                 |
| TikTok `/oauth/tiktok/callback`                                             | `UNCHANGED` / compatibility route                                 |
| `/mcp` JSON-RPC bearer endpoint                                             | `COMPATIBILITY ROUTE`                                             |
| OAuth metadata, `/oauth/authorize`, `/oauth/token`, `/oauth/register`       | `COMPATIBILITY ROUTE`                                             |
| `/api/auth/*`, `/api/me`, `/api/mcp-token*`, hosted/admin/diagnostic routes | `COMPATIBILITY ROUTE`                                             |
| Provider external account IDs и selected mappings                           | `MIGRATED INTERNALLY`                                             |
| Existing encrypted credentials                                              | `MIGRATED INTERNALLY`, reconnect не нужен при валидном credential |
| Existing service-token digest semantics                                     | `MIGRATED INTERNALLY`; plaintext hash не восстанавливается        |

Новые production hostname, DNS, OAuth application и callback URL для V2 не требуются. Google Login compatibility route отмечен отдельным `MUST_VERIFY_BEFORE_CUTOVER`.

## 6. Identity и security

Реализованы: Argon2id с rehash, transitional PBKDF2 login, opaque random server-side sessions, secure HttpOnly cookies, CSRF proof/origin checks, workspace membership authorization, OWNER/ADMIN/MEMBER/VIEWER RBAC, support grants, Redis rate limits, audit events, OAuth state binding/replay protection, PKCE capability, AES-256-GCM credential vault с key version/rotation path, scoped service-token lifecycle, account allowlists, generic safe errors и preview confirmation policy.

V1 High findings были: plaintext provider secrets, legacy global/unscoped MCP token bypass и service tokens без lifecycle. Они закрыты: credentials encrypted at rest, global access deny-by-default с workspace/provider/account scope, service tokens имеют expiry/revoke/last-used/rotation и индексы. В V2 проверены tenant isolation, foreign account rejection, read-token write rejection, preview replay protection и отсутствие secret leakage в логах.

Оставшийся security quality gap: MCP registry сейчас использует для части tools слишком широкую JSON Schema (`additionalProperties: true`). Это не даёт обхода tenant policy, но требует ужесточения контрактов до cutover.

## 7. Database и migration

V2 model включает users, workspaces, memberships, roles/permissions, sessions, invitations, OAuth states, provider connections, encrypted credentials, provider accounts, account access/selection, service tokens, audit events, analytics events, plans/prices/subscriptions/orders/payment attempts, usage и entitlements.

### Production-copy rehearsal

- 11 users;
- 11 workspaces;
- 11 memberships;
- 10 provider connections;
- 191 provider accounts;
- 12 service tokens;
- 11 legacy entitlements;
- 9 credential envelopes.

Importer dry-run/repeatable/idempotent: повторный запуск не создаёт дубли. Restore rehearsal прошёл. Credential path: V1 Fernet → decrypt only in memory → V2 AES-256-GCM → verification. Password path: PBKDF2 transitional login → Argon2id rehash after successful login. Production source DB не изменялась.

## 8. Google Ads

V2 поддерживает OAuth adapter, access-token refresh, developer-token/application configuration, direct и manager/customer discovery, login customer context, customer status, currency/timezone, campaigns, budgets, metrics, comparisons и diagnostics. GAQL изолирован внутри Google adapter, даты нормализуются в абсолютный range, деньги нормализуются без floating-point потери точности.

Реальная rehearsal-проверка на периоде `2026-08-15..2026-08-21`: 41 campaign; V1/V2 campaign-ID sets совпали по безопасному hash; spend `976.019831 USD`, impressions `226167`, clicks `29307`, conversions `1521.823727`; diagnostics healthy. Исправлены реальные причины generic error: неверный REST path `googleAds:searchStream`, неподдерживаемое поле `campaign_budget.currency_code` в metrics query и потеря snake_case credential/login-manager context при миграции.

Известное отличие: deactivated external account считается provider state, а не системной ошибкой. Широкая выборка всех production Google connections и load/performance parity ещё не выполнялась.

## 9. Meta Ads

V2 поддерживает OAuth lifecycle, requested/granted/missing permissions, ad account discovery, campaigns, statuses, objectives, budgets, insights metrics, Business Portfolio, Pages, Page posts/engagement, Page → `instagram_business_account`, diagnostics и internal mutation boundary.

Реальная rehearsal-проверка: 4 campaigns; V1/V2 campaign-ID sets совпали по безопасному hash; spend `147.83 USD`, impressions `54451`; обнаружены 10 Businesses, 38 Pages, 2 live Page posts; Page→Instagram mapping linked; 6 permissions granted, 0 missing; diagnostics healthy.

Зафиксирована семантическая разница, а не скрытая потеря данных: V1 использует `inline_link_clicks` и суммирует все Meta actions, V2 использует `insights.clicks` и только явно разрешённые conversion action types. Поэтому исторические значения V1 `3030 clicks / 14660 conversions` и V2 `3136 clicks / 22 conversions` не byte-identical и требуют показывать provenance/semantics.

## 10. Yandex и TikTok

В V1 подтверждены OAuth/discovery/preview boundaries, но не полноценный live reporting parity. В V2 сохранены registry и OAuth/discovery adapters/контракты. Полноценные production campaign/metrics reads и live V1/V2 parity не подтверждены. Это не доказанная регрессия V1, но production capability gap, если эти providers обещаются клиентам на cutover.

## 11. MCP

Исторический V1 inventory — 135 tool names. В V2 compatibility registry зарегистрировал 140 имен: 135 legacy-compatible names плюс V2 extensions/aliases. Full parity считается только там, где есть реальная capability; unsupported names возвращают явный `data_status=unsupported`.

Transport — HTTP JSON-RPC `/mcp`; auth — bearer service token с SHA-256 digest, scopes, workspace restriction, optional account allowlist, expiry/revoke/last-used. Read path проверяет tenant/account policy server-side. Write path: request → preview → one-time confirmation → server policy → scope/allowlist → commit boundary → reread → audit. Глобальный default остаётся preview-only; реальные production writes не включались.

Подтверждены расходы, campaigns, metrics, comparisons, diagnostics, account selection, reports, Meta assets и Google reads на rehearsal. Не подтверждены как полноценные все старые detailed ad/adset/ad-group/keyword/creative/PDF capabilities; часть остаётся unsupported/preview-only.

## 12. Hermes

`apps/hermes` — отдельный runtime без прямого доступа к provider credentials/DB. Использует scoped service identity и allowlisted workspace/accounts, read-only default, Telegram polling, deterministic Russian analytics, comparisons, ranking, follow-ups и optional OpenAI enhancement.

Локальный E2E с fake Telegram transport и реальным V2 MCP HTTP прошёл для spend, active campaigns, ranking, comparison и follow-up conversions; write request безопасно отклоняется; OpenAI disabled fallback работает. Настоящий Telegram E2E не выполнен: нужен отдельный тестовый bot token и allowlisted chat, production Telegram менять нельзя.

## 13. Web, dashboard и SEO

Функционально присутствуют login/register/reset, dashboard, workspace/members, provider connections, advertising accounts, MCP/service tokens, reports, Hermes section, billing/legacy entitlement, profile и admin/support diagnostics.

Публичная часть Next.js имеет SSR metadata, canonical, robots, sitemap, Open Graph, JSON-LD и private `noindex` controls. Внутренний HTTP smoke для `/`, `/auth`, `/auth/reset`, `/app`, `/dashboard`, `/robots.txt`, `/sitemap.xml`, `/api/health` прошёл. Полный Playwright desktop/mobile E2E не выполнен: в текущем environment Playwright отсутствует; закрыть через headless CI runner.

## 14. Reports

V2 имеет KPI/performance reports, spend, CPM, conversion value при однозначном источнике, equal-period comparison, conclusions/provenance и branded DOCX generation. Entitlement/quota enforcement выполняется server-side. Полная parity со всеми старыми PDF/detailed ad reports не доказана; async artifact delivery и расширенная визуальная QA остаются задачами.

## 15. Billing

Billing — новая V2 функция, которой в V1 не было. Реализованы domain tables и server-side model plans, prices, subscriptions, billing periods, entitlements, usage, limits/quotas, orders и payment attempts, а также provider abstraction.

Реальный payment provider не выбран, checkout, webhook signature verification и фактический приём денег не включены. Legacy/internal entitlement для существующих workspaces сохраняет V1-доступ без оплаты; платёжная интеграция требуется отдельно до коммерческого запуска billing.

## 16. Analytics, admin и observability

Есть privacy-safe product events, MCP usage/audit, provider health, admin diagnostics, structured JSON logs, request/correlation IDs, safe error mapping и provider metrics foundation. В analytics/logs не должны попадать access/refresh tokens, service-token plaintext, cookies, keys, Authorization headers и provider secrets.

OpenTelemetry exporter, dashboards, alerting, external error tracking и полноценный queue/provider monitoring production-grade уровня ещё не подключены. Admin покрывает основную workspace-scoped диагностику, но широкое admin E2E не выполнено.

## 17. Background processing

Redis/BullMQ worker имеет retry/backoff, deduplication, graceful shutdown и internal test job. CI/workflow проверяет PostgreSQL 18, Redis 7.4, readiness, worker job и degradation при недоступности зависимостей. Foundation для discovery/health jobs есть, но полноценные периодические provider sync/health jobs и production monitoring ещё не завершены. Hermes является отдельным runtime и не включён как сервис в базовый `infra/docker-compose.v2.yml`.

## 18. Testing

Последний локальный V2 pipeline: typecheck, build/lint/format checks, secret scan и Vitest проходят; API — 56 passed и 14 skipped, Hermes — 9 passed, database — 1 passed и 3 skipped; skipped зависят от PostgreSQL/Redis и должны выполняться в CI. Ранее V1 pytest — 238 passed, Phase B API — 54 passed; текущий API count вырос до 56.

Отдельно подтверждены: migration idempotency, backup/restore rehearsal, provider contract fixtures, Google/Meta live read parity на одном connection, MCP tenant/account isolation, preview replay blocking, service-token scope checks и safe log scan. Реальный Docker Compose full-stack, PostgreSQL/Redis integration, browser Playwright и Telegram production-like E2E должны считаться подтверждёнными только соответствующими CI/operator run artifacts, а не локальными skipped тестами.

## 19. CI/CD

Есть `v2-foundation` workflow с PostgreSQL 18/Redis 7.4 services, migrations, migration/backup/restore rehearsal, readiness, worker, dependency degradation, secret scan и dependency audit. Есть `v2-compose-smoke` с build/up/down для web/api/worker/PostgreSQL/Redis, health/readiness, Redis и worker checks.

Production promotion, automated blue/green switch, backup gate, migration lock, rollback automation и post-cutover observation automation отсутствуют. Cutover пока manual по runbook. Compose smoke не включает Hermes; для Phase C нужен отдельный Hermes readiness/health gate.

## 20. Что менялось в V1 production

Документирован непосредственно выполненный V1 security rollout: encrypted provider credentials, закрытие legacy global token bypass, service-token lifecycle и regression checks; deployment reference — `042d667c7b587c3d79954f9ed1f9bb651e76a09f` в Phase 0.5 report. Предыдущие Meta App Review/OAuth fixes относятся к V1 development/deployment history и не являются V2 cutover.

V2 production не deployилась. Не менялись production Nginx, DNS, public hostname, OAuth applications, callback URLs и V1 production DB в рамках V2 work.

## 21. Ключевые commits

| Этап                       | Commit                                     | Суть                                           |
| -------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Phase 0                    | `08dd40970cf200134cb8e979e93a25d3ee1ee063` | полный архитектурный аудит                     |
| Phase 0.5                  | `9efd2d35014cd69dcaf7bcd8cf2306db89b93c75` | production safety/reconciliation documentation |
| Phase 1                    | `b6629e6`                                  | V2 foundation/monorepo/infrastructure          |
| Phase 2                    | `c0349da4c9e419d38027b10430cb30f88f33d810` | identity, sessions, RBAC, tenant security      |
| Phase 3                    | `5e227a29179becdbc0812354beeeb65b00a6203e` | provider framework/OAuth/vault                 |
| Phase 4                    | `40b001c5919f94a322b5dfd97554d8e1b5a81c49` | Google/Meta provider migration                 |
| Phase 4.5                  | `d2469de`                                  | full-stack/live verification foundations       |
| Phase B foundation         | `95012454beef9aa31b509d50e8f44233b5df0af1` | migration rehearsal/QA gates                   |
| Phase B automated QA       | `08a1993849848d850c5600f01f4f7d14ebf2015b` | automated migration/security QA                |
| Phase B operator rehearsal | `a3780891680ee18edea7222d111d9fc47769a13f` | Redis/provider parity/operator evidence        |
| Audit docs                 | current report commit                      | this consolidated report; runtime unchanged    |

## 22. Known blockers before Phase C

| Задача                                                                                                    | Severity                               | До Phase C?                    | Причина                                                                                                | Оценка                        |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Non-printing smoke конкретного сохранённого production service token или утверждённая transition strategy | BLOCKER                                | Да                             | plaintext token не восстанавливается из SHA-256; нужно доказать, что реальный клиент продолжит входить | 0.5–1 день                    |
| Полный compatibility smoke, особенно Google Login callback marked `MUST_VERIFY_BEFORE_CUTOVER`            | BLOCKER                                | Да                             | OAuth contract должен быть проверен на мигрированной БД без новых callback URL                         | 0.5–1 день                    |
| Headless Playwright desktop/mobile E2E в CI                                                               | MUST FIX                               | Да                             | HTTP smoke не доказывает browser auth, cookies, CSRF и layout-critical flows                           | 1–2 дня                       |
| Отдельный Telegram test bot/chat и Hermes E2E                                                             | MUST FIX, если Hermes входит в cutover | Да                             | production Telegram нельзя затрагивать; нужен безопасный контур                                        | 0.5–1 день + ручная настройка |
| Формальное решение по Yandex/TikTok scope                                                                 | MUST FIX                               | Да, если обещаны клиентам      | live campaign/metrics parity отсутствует; иначе явно выключить capability                              | 1–3 дня на scope/adapter      |
| Typed schemas для MCP tools                                                                               | MUST FIX                               | Желательно до cutover          | сейчас часть schemas допускает произвольные поля; policy всё равно server-side                         | 1–2 дня                       |
| Payment provider, checkout, webhooks                                                                      | SHOULD FIX                             | Нет для V1 drop-in             | billing новой V2 функцией не было в V1; нужно до приёма денег                                          | 3–7 дней                      |
| OTel exporter, dashboards, alerts, deployment automation                                                  | SHOULD FIX                             | Желательно                     | production operations пока manual/foundation-only                                                      | 2–5 дней                      |
| Periodic provider sync/health jobs, detailed reports/PDF                                                  | POST-CUTOVER или scope decision        | Нет, если read core достаточен | не подтверждены как обязательная V1 capability                                                         | 3–10 дней                     |

### Дополнительные gaps

- старые документы parity содержат `LIVE_VERIFICATION_PENDING`; они устарели относительно более позднего operator report и должны читаться с ним вместе;
- конкретный legacy service-token smoke не выполнен, использовался временный scoped token;
- полноценный real Telegram E2E отсутствует;
- browser visual/mobile E2E отсутствует;
- Yandex/TikTok live reporting не реализован;
- payment provider и email delivery adapter не подключены;
- broad real write adapters не открыты; Meta write boundary остаётся controlled/preview-only;
- production observability/alerting и автоматический promotion/rollback не завершены;
- Google/Meta parity подтверждена на одном стабильном rehearsal connection, а не на каждом клиентском connection;
- compatibility route manifest требует финального запуска против мигрированной runtime среды.

## 23. Минимальный план до Phase C

1. Запустить non-printing smoke реального сохранённого service token и зафиксировать account/scope result; если plaintext недоступен клиенту — заранее выполнить controlled token reissue для затронутого клиента.
2. В CI headless runner выполнить browser E2E, transitional login, dashboard, connections, MCP token, reports, billing entitlement и desktop/mobile checks.
3. Создать отдельный Telegram test bot/chat, выполнить Hermes E2E и удалить/отозвать тестовые credentials после проверки.
4. Выполнить compatibility manifest smoke, включая Google Login, все OAuth callback routes, `/mcp`, legacy auth/API routes, с теми же external paths и без изменения OAuth apps.
5. Зафиксировать scope decision для Yandex/TikTok, typed MCP schemas и production monitoring; только затем повторить backup, migration checksum и cutover readiness review.

## 24. Verdict

**Можно ли прямо сейчас выполнять Phase C? NO.**

До Phase C остаётся **3 обязательных операторских блока** из принятого Phase B списка: legacy service-token smoke/transition, Telegram test-contour E2E и Playwright browser E2E. Дополнительно перед переключением обязательно закрыть compatibility smoke Google Login и всех legacy routes. Если Hermes или Yandex/TikTok не входят в cutover scope, их следует явно исключить из production promise, а не считать реализованными.

**Estimated readiness: 95%.** Core migration, encryption, identity, tenant security, service-token compatibility, browser CI, external route smoke и Google/Meta read parity подтверждены; оставшиеся 5% — отдельный Telegram test-contour E2E и явное решение, входит ли Hermes в cutover scope.

## 25. Memora и источник истины

Memora используется только как локальная память разработки, без credentials и пользовательских секретов. Canonical artifacts остаются в `docs/architecture/v2/`, Git остаётся источником точного состояния кода, а текущий operator report имеет приоритет над более ранними статусными документами.

## 26. Финальная pre-cutover verification

Этот раздел supersedes устаревшие статусы из ранних Phase B таблиц.

### Existing service-token compatibility

**EXISTING SERVICE TOKEN COMPATIBILITY = VERIFIED (technical compatibility).** V1 хранит SHA-256 digest, plaintext восстановлению не подлежит и не требуется. В V2 добавлен integration proof: synthetic plaintext token хешируется тем же `hashServiceToken`, digest переносится без изменения, а V2 authentication возвращает исходные token/workspace restrictions. Production service tokens не инвалидировались и не reissue-ились. Controlled smoke именно существующего внешнего клиента не выполнялся, потому что plaintext клиента недоступен в безопасном operator-контуре.

### Browser and external contract

**BROWSER PLAYWRIGHT E2E = VERIFIED.** GitHub Actions run `32588367941` на commit `b791f9f0fb4988308b22ddeb2614a7ac46e9c33d` успешно выполнил desktop Chromium и mobile Chromium: transitional legacy login, register, dashboard, workspace creation/switching, connections, advertising-account surface, MCP/service-token surface, reports, billing/legacy entitlement и profile/admin-critical surface. Browser console errors и failed requests не обнаружены.

**EXTERNAL CONTRACT COMPATIBILITY = VERIFIED.** Run `32588367941` прошёл `scripts/v2-compatibility-smoke.mjs`: `/health`, `/ready`, `/mcp`, OAuth metadata, legacy auth/CSRF/registration routes, Google/Meta/Yandex/TikTok callback routes, legacy report и MCP-token routes. В CI provider OAuth credentials не выдавались, поэтому это route/contract smoke, а не новый OAuth exchange. Production hostname `mcp.holymedia.kz`, DNS, OAuth applications и callback URLs не менялись.

### CI result

На финальном commit `b791f9f0fb4988308b22ddeb2614a7ac46e9c33d` зелёные:

- foundation run `32588367932`: PostgreSQL 18, Redis 7.4, migrations, migration/restore rehearsal, integration tests, readiness/degradation, worker job, secret scan и dependency audit;
- full-stack Compose run `32588367945`: build/up для PostgreSQL, Redis, API, worker и web, `/health`, `/ready`, Redis, worker и teardown;
- browser/compatibility run `32588367941`: Playwright desktop/mobile и external route smoke.

Локально после исправлений: format, lint, typecheck, build, secret scan и dependency audit зелёные; Vitest: API `56 passed`, `15 skipped` (DB/Redis-only skipped без локального Docker), Hermes `9 passed`; ранее V1 pytest `238 passed`. Обязательные DB/Redis/Compose checks подтверждены CI, а не локальными skipped-тестами.

### Единственный оставшийся обязательный блокер

**PHASE B NOT READY.** Для включения Hermes в Phase C нужен отдельный безопасный Telegram test contour, которого нет в текущей среде. Ручное действие: создать отдельного бота через BotFather, создать закрытую test group/chat, добавить бота, сохранить token только в закрытом V2 rehearsal env и указать allowlisted chat id. После этого выполнить Telegram → Hermes → scoped service identity → V2 MCP/API → migrated account для расходов, активных кампаний, ranking, сравнения, follow-up, write rejection, duplicate-update protection и deterministic fallback без OpenAI. Production Telegram bot/chat не использовать.

Billing payment provider, Yandex/TikTok live reporting, broad write adapters, production monitoring/alerting и automated promotion остаются post-cutover или scope decisions: их отсутствие не блокирует V1 → V2 drop-in cutover, если они не заявлены как существующие V1 capabilities.

**Актуальный verdict:** Phase C не выполнять до закрытия Telegram E2E либо до отдельного явного решения не включать Hermes в cutover scope. После этого изменения не затрагивали V1 production, Nginx, DNS, OAuth applications, callback URLs или public traffic.

## 28. Phase C execution result (2026-08-22/23)

This section supersedes earlier pre-cutover wording. It records the actual
operator execution without secrets.

- V1 production source: `c700fb7cf46884ad91bf4f8edc7b723a673f1446`.
- V2 runtime/config source: `346ea45`; immutable GHCR image: `sha-0821907ed669eb96a1a7d1ab4b4ae894dc11dc47`.
- V2 was built in GitHub Actions and pulled on the VPS. No heavy production-VPS build was used.
- VPS protection added before runtime start: 2 GiB swap and persistent overcommit setting. V1 remained active during the operation.
- Verified backup: `/var/backups/adforge-mcp/phase-c-20260822T204959Z`; manifest, read check and SHA-256 checksums verified.
- Actual production-copy migration counts: users 11, workspaces 11, memberships 11, connections 10, credential envelopes 9, accounts 191, service identities 7, service tokens 12, MCP OAuth clients 1, legacy entitlements 11.
- Prisma migrations applied to PostgreSQL 18. Repeated import produced no duplicates and stable counts. All 9 migrated credential envelopes decrypted successfully in V2; source credentials remained untouched.
- V2 runtime: PostgreSQL 18, Redis 7.4.11, API, worker and web all healthy. Direct `/health` and `/ready` returned 200. BullMQ foundation job completed. V1 ports `8765/8766` remained healthy for rollback.
- Technical service-token compatibility: the complete SHA-256 digest set is identical before/after migration (`12/12` intersection, no missing or extra digest). No production plaintext token was available or reissued.
- Production provider reality: Meta, Yandex and TikTok connections exist; no Google production connection exists, so Google live smoke is `N/A - no production connection`.
- Meta V2 read smoke passed on migrated data: 4 campaigns, live metrics, diagnostics, 10 businesses, 1 business ad-account relation, 38 pages, 2 live page posts, 6 granted permissions and no missing permissions. No writes were executed.
- Yandex and TikTok credential decrypt/discovery smoke passed. Their V2 scope remains the V1-compatible OAuth/discovery surface; no unsupported live reporting was claimed.
- Internal compatibility smoke passed for health/readiness, MCP unauthenticated 401, legacy auth/session/me/hosted-report routes, provider callback contracts and OAuth metadata.
- Nginx was switched in place from V1 upstreams to V2 loopback upstreams. DNS, `mcp.holymedia.kz`, TLS, OAuth applications and callback URLs were unchanged. V1 systemd services remain active and previous Nginx configs are backed up for rollback.
- Public smoke passed after the switch: HTTPS root, health/readiness and unauthenticated `/mcp` contract. The `/auth` exact route was corrected to avoid an unintended prefix-slash 404. Next inline hydration CSP was aligned with the built application without enabling `unsafe-eval`.
- Browser smoke passed on desktop and mobile for public/auth surfaces. A controlled signup -> session -> dashboard -> workspace selector -> Billing flow passed on desktop with zero console/request failures; the temporary smoke account was removed after the test.
- Telegram Hermes real E2E remains `DEFERRED BY PROJECT DECISION`; Hermes was not removed and no Telegram credentials were created.
- Critical findings: `0`. High findings: `0`. Payment gateway, Yandex/TikTok reporting expansion and Hermes Telegram E2E remain non-blocking deferred items.

Final operator verdict: `PHASE C COMPLETE - V2 IS PRODUCTION`.

`V1 RETAINED FOR ROLLBACK / OBSERVATION PERIOD`.

## 27. Phase C operator decision

Этот раздел является актуальным решением владельца проекта и supersedes ранние формулировки о Telegram как обязательном blocker:

- Telegram real E2E: `DEFERRED BY PROJECT DECISION` — проверка не выполнялась и не считается `VERIFIED`.
- Hermes не удаляется и не меняет архитектуру; Telegram E2E будет выполнен отдельной задачей.
- Остальные pre-cutover проверки приняты: service-token compatibility, Playwright, external routes/OAuth callbacks, `/mcp`, migration rehearsal, Google/Meta parity, idempotency, backup/restore, CI и security gates.
- Critical findings: `0`.
- High findings: `0`.
- Production V1, Nginx, DNS, OAuth applications, callback URLs и public traffic до фактического cutover не изменялись.

Операторские production gates выполнены: backup и checksum, финальная миграция, V2 internal runtime, internal smoke, Nginx switch и public smoke. V1 runtime сохранён для rollback/observation period.

## 30. Final V1 decommission (2026-08-23)

- Final V1 archive: `/var/backups/adforge-mcp/v1-decommission-20260823T155459Z`. The PostgreSQL dump, source/runtime, storage, configuration, unit files and immutable rollback Nginx configuration were archived. SHA-256 verification and readability checks passed.
- Live and staging V1 units were stopped and disabled: `adforge-mcp-web.service`, `adforge-mcp-http.service`, `adforge-mcp-staging-web.service` and `adforge-mcp-staging-http.service`.
- V1 ports `8765`, `8766`, `18765` and `18766` are closed. V1 autostart is disabled. V1 source, production data and configuration remain preserved; only archived disposable production `.venv` and `.cache` were removed from the active filesystem.
- Active Nginx is V2-only and `nginx -t` passed. Public `/health=200`, `/ready=200` and unauthenticated `/mcp=401` remained healthy after V1 shutdown.
- Compatibility smoke, browser desktop/mobile smoke and Meta read smoke passed after decommission. Yandex/TikTok retain their V1-compatible OAuth/discovery capability. Google remains `N/A - no production connection`.
- Free disk increased from approximately `2.8 GB` to `4.3 GB` (`86%` to `78%` used). V2 data, images, encryption material, Phase C backup, post-cutover backup and final V1 archive were retained.
- Critical findings: `0`. High findings: `0`. Telegram Hermes real E2E remains `DEFERRED BY PROJECT DECISION`.

Final verdict: `V1 DECOMMISSION COMPLETE` / `HOLYMEDIA MCP V2 FULLY PRODUCTION`.

## 29. Post-cutover stabilization

- Disk remediation: free space increased from approximately `1.4 GB / 93% used` to `3.4 GB / 83% used`.
- Removed only archived systemd journal data and apt cache. Journal retention is now capped by `/etc/systemd/journald.conf.d/holymedia-retention.conf` at 250 MB system usage / 100 MB runtime usage / 14 days.
- Preserved: V2 production image and active containerd layers, PostgreSQL and Redis state, V1 runtime and ports, all Phase C backups, encryption material and active configuration.
- Docker log rotation is active: json-file, API/worker/web `20m x 5`, PostgreSQL/Redis `10m x 5`.
- V2 PostgreSQL, Redis, API, worker and web remained healthy with restart count `0`. Public `/health` and `/ready` remained `200/200`; OOM events and disk-full warnings were `0` for the checked 24-hour window.
- Latest Meta read observation passed: campaigns, metrics, diagnostics, Business, Pages and live Page posts. Temporary scoped token checks confirmed read access, foreign-account rejection, write rejection, revoked-token rejection and expired-token rejection. Temporary identities/tokens were removed.
- Yandex/TikTok remain V1-compatible OAuth/discovery capabilities; no unsupported live reporting was claimed. Google remains `N/A - no production connection`.
- Browser desktop/mobile production regression passed with no console errors or failed requests.
- Existing Phase C backup remained readable and checksum-valid. New post-cutover backup: `/var/backups/adforge-mcp/post-cutover-v2-20260822T214700Z`; PostgreSQL dump, Redis state, V2 config, current Nginx config and immutable V1 rollback config were checksum-verified.
- Rollback readiness is confirmed without switching public traffic: V1 services are active, ports `8765/8766` respond, V1 commit `c700fb7` is retained, and the new backup contains `nginx-v1-rollback.conf` with MCP `8766` and web/API `8765` upstreams.
- Security regression: secret scan passed, dependency audit reported no known vulnerabilities, Critical `0`, High `0`.

Post-cutover verdict: `POST-CUTOVER STABILIZATION PASSED`.

V1 verdict: `V1 DECOMMISSION READY - AWAITING OWNER APPROVAL`.

V1 was not stopped, deleted or decommissioned. Telegram Hermes E2E remains `DEFERRED BY PROJECT DECISION`; payment gateway and extended Yandex/TikTok reporting remain non-blocking scope items.

# HolyMedia MCP beta-ready MVP

HolyMedia MCP - hosted MCP-сервис для работы с рекламными кабинетами через AI-клиенты. Пользователь подключает рекламные платформы через dashboard и OAuth, затем подключает уже развернутый MCP endpoint в Codex, Claude, Gemini или другой MCP-compatible клиент.

Клиент не скачивает GitHub-репозиторий, не запускает Python-сервер локально и не редактирует `.env` или `ads_config.yaml`.

## Общий сценарий

1. Команда HolyMedia разворачивает dashboard и MCP transport на VPS/WPS.
2. Пользователь получает dashboard URL, hosted MCP URL и beta token.
3. Пользователь открывает dashboard и проходит OAuth для рекламных платформ.
4. После OAuth пользователь выбирает доступные рекламные аккаунты.
5. Dashboard показывает статус подключения и диагностику.
6. Пользователь добавляет hosted MCP URL в Codex, Claude или другой MCP-клиент.
7. AI-клиент вызывает MCP tools и получает данные из подключенных рекламных аккаунтов.
8. Любые потенциально опасные действия возвращают только preview, без реального применения.

## Что реально входит в beta

| Область | Статус |
| --- | --- |
| Hosted MCP transport | Реализован через Streamable HTTP endpoint `/mcp`. |
| Dashboard Connections | Реализованы карточки платформ, OAuth start, pending account selection, reconnect, disconnect, diagnostics. |
| Web API auth | Закрыт beta token из `AD_MCP_WEB_API_TOKEN`. |
| Connection storage | `tokens/connections.json`, ignored runtime-файл для beta. |
| Diagnostics | Backend endpoints, dashboard statuses и MCP tool `run_diagnostics`. |
| Preview-only safety | Реальные write-действия заблокированы, preview tools возвращают `will_apply=false`. |

## Поддержка платформ

| Платформа | Beta status |
| --- | --- |
| Meta Ads | OAuth, account selection, campaigns, campaign statuses, basic metrics и diagnostics. Работает при валидных Meta credentials и доступах. |
| Google Ads | OAuth, customer account selection, campaigns, campaign statuses, basic metrics и diagnostics. Требуются OAuth credentials и Google Ads developer token. |
| TikTok Ads | OAuth groundwork и сохранение подключения. Campaigns/metrics в текущей beta могут возвращать `not_available`; fake metrics не используются. |
| Yandex Direct | OAuth groundwork и сохранение подключения. Campaigns/metrics в текущей beta могут возвращать `not_available`; fake metrics не используются. |

## Что можно спрашивать у AI

- `Проверь диагностику HolyMedia MCP`.
- `Покажи подключенные рекламные платформы`.
- `Покажи список рекламных аккаунтов`.
- `Покажи кампании Meta Ads`.
- `Покажи кампании Google Ads за последние 7 дней`.
- `Покажи статусы и бюджеты кампаний`.
- `Покажи базовые метрики по аккаунту за вчера`.
- `Сделай preview изменения бюджета кампании, но ничего не применяй`.

## Что пока в планах

- Production multi-tenant isolation.
- Database-backed encrypted token storage вместо beta JSON storage.
- Более глубокие TikTok Ads и Yandex Direct read tools.
- Real write/apply flow после отдельного security review.
- Billing, roles, team permissions и audit UI.
- ClickHouse persistence как отдельный production-слой аналитики.

## Safety

В beta все dangerous/write-сценарии работают только в preview-only mode:

- `AD_MCP_PREVIEW_ONLY=true`;
- `will_apply=false`;
- `commit_preview` возвращает blocked status;
- provider write endpoints не вызываются;
- токены и секреты не выводятся в API, diagnostics или dashboard.

Подробнее: [BETA_SECURITY_RU.md](BETA_SECURITY_RU.md).

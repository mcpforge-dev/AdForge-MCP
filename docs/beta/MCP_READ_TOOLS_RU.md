# MCP read tools для beta-ready MVP

HolyMedia MCP работает как hosted MCP-сервис. Пользователь подключает внешний MCP endpoint в Codex, Claude или другой MCP-compatible клиент, а рекламные кабинеты подключает через dashboard и OAuth.

## Tools

- `run_diagnostics` - проверяет backend, hosted MCP transport, storage, env readiness, connections и tools readiness.
- `list_connected_platforms` - показывает подключенные рекламные платформы, источники runtime config и количество аккаунтов.
- `list_ad_accounts` - показывает выбранные рекламные аккаунты по всем платформам или по одной платформе.
- `get_account_status` - показывает статус конкретного аккаунта: `active`, `not_connected`, `reconnect_required`, `expired` или `error`.
- `run_connection_diagnostics` - проверяет наличие выбранных аккаунтов, credentials и, при `live_check=true`, пробует безопасный read-запрос.
- `list_campaigns` - возвращает кампании по платформе и аккаунту.
- `get_campaign` - возвращает одну кампанию.
- `get_campaign_statuses` - возвращает статусы кампаний и счетчики по статусам.
- `get_basic_metrics` - возвращает spend, impressions, clicks, ctr, cpc, cpm, conversions, cost_per_conversion за период.

## Параметры

Основные параметры:

- `platform`: `meta_ads`, `google_ads`, `tiktok_ads`, `yandex_direct`.
- `account_id`: выбранный рекламный аккаунт из dashboard.
- `campaign_id`: опционально, для детализации или фильтрации.
- `date_from`, `date_to`: ISO-даты, например `2026-06-01`.
- `limit`: лимит строк.
- `status`: фильтр статуса кампании, если поддерживается провайдером.
- `level`: `account` или `campaign` для метрик.

## Поддержка по платформам

Meta Ads:

- Кампании читаются через Meta Marketing API.
- Метрики читаются через insights.
- Для campaign filter используется `campaign.id`.

Google Ads:

- Кампании читаются через Google Ads API / GAQL.
- Метрики читаются через Google Ads API / GAQL.
- Для campaign filter используется числовой `campaign.id`.

TikTok Ads:

- OAuth и сохранение подключений есть.
- Реальное чтение кампаний и метрик пока возвращает `not_available`, чтобы не выдавать fake data.

Yandex Direct:

- OAuth и сохранение подключений есть.
- Реальное чтение кампаний и метрик пока возвращает `not_available`, чтобы не выдавать fake data.

## Примеры ручной проверки

После подключения аккаунта через dashboard можно спросить MCP-клиент:

- "Покажи подключенные рекламные аккаунты".
- "Покажи кампании Meta Ads".
- "Покажи статусы кампаний Google Ads".
- "Покажи базовые метрики по аккаунту за вчера".
- "Проверь, работает ли подключение к Meta Ads".

Для диагностики live API используйте `run_connection_diagnostics` с `live_check=true`. Без реальных credentials или нужных SDK tool вернет структурированную ошибку или `not_available`, а не fake-результат.

Полная справка по beta tools: [MCP_TOOLS_REFERENCE_RU.md](MCP_TOOLS_REFERENCE_RU.md).

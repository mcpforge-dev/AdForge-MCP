# MCP tools reference для beta

Эта справка описывает hosted beta tools. Примеры ниже показывают структуру ответа, а не реальные данные. HolyMedia MCP не возвращает fake metrics как настоящие: если provider data недоступны, tool возвращает `not_available` или структурированную ошибку.

## Общие параметры

- `platform`: `meta_ads`, `google_ads`, `tiktok_ads`, `yandex_direct`.
- `account_id`: рекламный аккаунт, выбранный в dashboard.
- `campaign_id`: campaign id, если нужен один объект.
- `date_from`, `date_to`: даты в ISO-формате `YYYY-MM-DD`.
- `limit`: лимит строк.
- `status`: фильтр статуса кампании, если поддерживается provider.
- `level`: `account` или `campaign` для metrics.
- `live_check`: `true` включает безопасные read-checks в diagnostics.

## Diagnostics

### `run_diagnostics`

Назначение: кратко проверить backend, hosted MCP, storage, env variables, connections и readiness tools.

Параметры: `live_check=false`.

Пример запроса: `Проверь диагностику HolyMedia MCP`.

Пример структуры ответа:

```json
{
  "status": "ok",
  "mcp": {"ready": true, "auth_required": true},
  "platforms": [{"provider": "meta_ads", "status": "mcp_ready"}],
  "missing_env": [],
  "next_actions": []
}
```

Ограничения: secrets показываются только как present/missing.

### `list_connected_platforms`

Назначение: показать подключенные платформы и количество выбранных аккаунтов.

Параметры: нет.

Пример запроса: `Покажи подключенные рекламные платформы`.

Если подключений нет, вернет пустой список platforms.

### `run_connection_diagnostics`

Назначение: проверить конкретную платформу/аккаунт или все подключения.

Параметры: `platform`, `account_id`, `live_check`.

Пример запроса: `Проверь, работает ли подключение к Meta Ads`.

При `live_check=true` выполняются только безопасные read-запросы.

### `get_account_status`

Назначение: показать статус подключения аккаунта.

Параметры: `platform`, `account_id`.

Пример ответа: `active`, `expired`, `reconnect_required`, `error`, `not_connected`.

## Accounts

### `list_ad_accounts`

Назначение: показать выбранные в dashboard рекламные аккаунты.

Параметры: `platform` опционально.

Пример запроса: `Покажи список рекламных аккаунтов`.

Пример структуры ответа:

```json
{
  "status": "ok",
  "accounts": [
    {"platform": "meta_ads", "account_id": "act_...", "name": "Example", "status": "active"}
  ]
}
```

## Campaigns

### `list_campaigns`

Назначение: вернуть список кампаний по платформе и аккаунту.

Параметры: `platform`, `account_id`, `limit`, `status`.

Пример запроса: `Покажи кампании Meta Ads`.

Поддержка: Meta Ads и Google Ads при валидных credentials. TikTok/Yandex могут вернуть `not_available`.

### `get_campaign`

Назначение: вернуть подробности одной кампании.

Параметры: `platform`, `account_id`, `campaign_id`.

Пример запроса: `Покажи детали кампании 123`.

Если кампания не найдена или provider недоступен, tool возвращает понятную ошибку.

### `get_campaign_statuses`

Назначение: вернуть статусы кампаний и счетчики по статусам.

Параметры: `platform`, `account_id`, `limit`.

Пример запроса: `Покажи статусы кампаний Google Ads`.

Статусы нормализуются, но raw provider status сохраняется в объекте кампании, если он доступен.

## Metrics

### `get_basic_metrics`

Назначение: вернуть базовые метрики за период.

Параметры: `platform`, `account_id`, `date_from`, `date_to`, `campaign_id`, `level`.

Минимальный набор:

- `spend`;
- `impressions`;
- `clicks`;
- `ctr`;
- `cpc`;
- `cpm`;
- `conversions`, если provider возвращает;
- `cost_per_conversion`, если provider возвращает;
- `currency`;
- `date_range`.

Пример запроса: `Покажи базовые метрики по аккаунту за вчера`.

Если provider не поддержан или credentials недоступны, ответ будет `not_available`, а не синтетические метрики.

## Preview-only actions

Все preview tools:

- читают текущее состояние объекта, если это возможно;
- строят expected result;
- возвращают `mode=preview_only`;
- возвращают `will_apply=false`;
- не вызывают provider write endpoints.

### Campaign preview tools

- `preview_pause_campaign`: preview остановки кампании.
- `preview_resume_campaign`: preview включения кампании.
- `preview_change_campaign_budget`: preview изменения бюджета.
- `preview_change_campaign_name`: preview изменения названия.

Параметры: `platform`, `account_id`, `campaign_id`; для бюджета - `new_budget`, `budget_type`/currency-поля если поддержаны; для названия - `new_name`.

### Ad set / group preview tools

- `preview_pause_adset_or_group`;
- `preview_resume_adset_or_group`;
- `preview_change_adset_or_group_budget`.

Параметры: `platform`, `account_id`, `adset_or_group_id`, для бюджета - requested budget fields.

### Ad preview tools

- `preview_pause_ad`;
- `preview_resume_ad`.

Параметры: `platform`, `account_id`, `ad_id`.

Пример структуры ответа:

```json
{
  "mode": "preview_only",
  "will_apply": false,
  "platform": "meta_ads",
  "account_id": "act_...",
  "object_type": "campaign",
  "object_id": "...",
  "action": "change_budget",
  "current_value": "10000 KZT/day",
  "requested_value": "15000 KZT/day",
  "expected_result": "Budget would change from 10000 to 15000 KZT/day.",
  "risk_level": "medium",
  "note": "Реальное изменение не выполнено."
}
```

Если текущее состояние невозможно получить, preview возвращает ошибку или `not_available`.

## Platform support summary

| Tool group | Meta Ads | Google Ads | TikTok Ads | Yandex Direct |
| --- | --- | --- | --- | --- |
| Diagnostics | Да | Да | Да, limited | Да, limited |
| Accounts | Да | Да | Да, после OAuth | Да, после OAuth |
| Campaigns | Да | Да | `not_available` в текущей beta | `not_available` в текущей beta |
| Metrics | Да | Да | `not_available` в текущей beta | `not_available` в текущей beta |
| Preview-only actions | Да при read-current-state | Да при read-current-state | Limited / `not_available` | Limited / `not_available` |

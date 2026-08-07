# Контракт интеграции

Разработчик должен сопоставить реальные MCP-инструменты с операциями ниже. Названия инструментов не фиксировать в скилле.

## Обязательные операции

| Операция | Вход | Минимальный выход |
|---|---|---|
| `list_accounts` | платформа | account ID, name, currency, timezone |
| `get_campaign_performance` | account ID, period, attribution | entity IDs, status, spend, impressions, reach, clicks, results, conversion IDs |
| `get_creative_performance` | account ID, period | ad/creative IDs, names, asset reference, spend, results, engagement/video metrics |
| `get_change_history` | account ID, period | timestamp, actor, entity ID, field, old value, new value |
| `get_auction_insights` | Google account/campaign, period | domain and supported auction metrics |
| `read_change_log` | account IDs, period | entries conforming to `change-log.schema.json` |
| `write_change_log` | confirmed entry | persisted entry ID |
| `read_business_funnel` | period, campaign/source IDs | leads, qualified, appointments, visits, sales/operations, revenue |
| `request_user_answers` | questions | answers with respondent and timestamp |
| `save_report_dataset` | validated dataset | stable dataset reference |
| `render_report` | validated dataset, template | output artifact reference |

Не объявлять необязательную операцию доступной, пока реальный MCP-инструмент и его права не проверены.

## Нормализация

- Хранить платформенные ID строками.
- Хранить деньги как `{amount, currency}` без неявной конвертации.
- Хранить даты в ISO 8601 и указывать timezone.
- Сохранять окно атрибуции и определение каждой конверсии.
- Возвращать `null`, `unavailable` или ошибку источника вместо вымышленного нуля.
- Сохранять ссылку на исходный вызов, выгрузку или запись в `source_ref`.

## Режимы выполнения

- Интерактивный: задать вопросы и продолжить после ответов.
- Асинхронный: сохранить `question_set`, вернуть состояние `WAITING_FOR_INPUT`, продолжить тем же `report_run_id`.
- Черновой: выпустить только фактические таблицы и список пробелов.
- Финальный: разрешить только после успешной валидации.

## Идемпотентность

Использовать `report_run_id`, `account_id`, `period` и стабильные entity ID. Повторный запуск не должен создавать дубли вопросов или журнала.

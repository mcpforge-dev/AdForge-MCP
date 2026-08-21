# Hermes V2

Hermes — отдельный runtime `apps/hermes`, который работает поверх HolyMedia
MCP HTTP. Он не импортирует database package и не получает provider credentials.

## Безопасная конфигурация

При `HERMES_ENABLED=true` обязательны:

- Telegram bot token;
- scoped `HERMES_MCP_TOKEN`;
- непустой `HERMES_ALLOWED_CHAT_IDS`;
- HTTP(S) URL HolyMedia MCP без user/password в URL.

`HERMES_CHAT_ACCOUNT_BINDINGS` дополнительно фиксирует чат на конкретном account
ID. Итоговое ограничение всё равно проверяет HolyMedia MCP service token, поэтому
конфигурация Hermes не может расширить workspace или account scope.

## Обработка сообщений

Поддерживаются `/hermes`, упоминание бота и reply в том же чате/topic. Обычные
сообщения игнорируются, update IDs дедуплицируются, ответы отправляются в тот же
chat/thread и ограничиваются безопасной длиной Telegram-сообщения.

Аналитика строится локально из реальных MCP read-ответов: метрики, сравнение
завершённых периодов, лидирующие кампании, доли расходов и follow-up контекст.
OpenAI — только необязательная переписывающая прослойка с `store=false`; при
любой ошибке сохраняется deterministic ответ и проверяется набор числовых фактов.

Любой запрос на изменение бюджета, кампании, объявления или другого объекта
отклоняется до обращения к MCP с сообщением о read-only режиме.

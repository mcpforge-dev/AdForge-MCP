# Подключение AdForge MCP к AI-клиентам

AdForge MCP работает как hosted remote MCP server:

- URL: `https://your-domain.com/mcp`
- Transport: Streamable HTTP
- Auth: персональный MCP token пользователя через `Authorization: Bearer <PERSONAL_MCP_TOKEN>`

Пользователь не скачивает репозиторий, не запускает сервер локально и не получает provider secrets рекламных платформ.

## Codex

Статус: готово.

1. В dashboard открыть раздел `MCP`.
2. Создать персональный MCP token.
3. В Codex добавить новый MCP server.
4. Выбрать Streamable HTTP, если клиент просит тип транспорта.
5. Вставить MCP URL.
6. Передать token одним из безопасных способов:

```http
Authorization: Bearer <PERSONAL_MCP_TOKEN>
```

или через переменную окружения:

```text
ADFORGE_MCP_CLIENT_TOKEN
```

Если token попал в скриншот, чат или лог, его нужно сразу обновить в dashboard.

## Claude

Статус: готово для Claude-клиентов/API, которые поддерживают remote MCP URL и access token.

1. Добавить custom remote MCP connector/server.
2. Указать URL hosted endpoint.
3. Если интерфейс просит token/header, передать персональный MCP token как Bearer access token.
4. После сохранения открыть новый чат и включить connector/tools, если клиент это требует.

Для Claude.ai custom connectors интерфейс может требовать OAuth-настройки на стороне организации или аккаунта. В таком случае используйте OAuth-сценарий, а не отключение авторизации на `/mcp`.

## ChatGPT

Статус: требуется OAuth 2.1 для полноценного ChatGPT Apps/connector сценария.

Текущий hosted endpoint технически является remote MCP server, но для пользовательских рекламных данных нельзя делать небезопасный no-auth connector и нельзя просить клиента вставлять raw MCP token в неподходящее поле ChatGPT Apps.

Безопасный production-путь:

- добавить OAuth authorization server;
- опубликовать protected resource metadata;
- поддержать authorization-code flow с PKCE;
- добавить scopes для read/preview-действий;
- хранить и ротировать access/refresh tokens безопасно;
- добавить revoke/logout и audit events;
- пройти тестирование ChatGPT Apps/connector flow.

До этого клиентский self-serve сценарий поддерживается через Codex и Claude-клиенты, которые умеют remote MCP URL + Bearer token.

## Проверочные вопросы после подключения

- `Какие рекламные аккаунты подключены?`
- `Покажи подключенные платформы.`
- `Какие кампании есть в подключенных аккаунтах?`
- `Покажи статусы кампаний.`
- `Покажи базовые метрики за последние 7 дней.`

## Ограничения безопасности

- `/mcp` не должен быть публичным без авторизации.
- Raw MCP token показывается пользователю только один раз.
- В базе хранится hash/prefix, а не raw token.
- Рекламные write-действия остаются preview-only.
- Provider credentials не передаются AI-клиентам.

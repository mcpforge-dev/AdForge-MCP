# Подключение HolyMedia MCP к AI-клиентам

HolyMedia MCP работает как hosted remote MCP server:

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

Статус: Claude.ai custom connector готов через OAuth discovery, Dynamic Client Registration и PKCE.

В Claude.ai форме `Add custom connector`:

1. `Name`: `HolyMedia MCP`.
2. `Remote MCP server URL`: `https://your-domain.com/mcp`.
3. `OAuth Client ID`: оставить пустым или вставить значение из dashboard, если Claude зависает на `Checking connection`.
4. `OAuth Client Secret`: оставить пустым или вставить одноразово показанный secret из dashboard.

Персональный MCP token нельзя вставлять в `OAuth Client Secret`: это не тот тип секрета.

После нажатия `Add` / `Connect` Claude должен:

1. Прочитать protected resource metadata.
2. Найти authorization server metadata.
3. Зарегистрировать OAuth client через Dynamic Client Registration.
4. Открыть браузерный вход в HolyMedia MCP.
5. Получить authorization code и обменять его на access token через PKCE.

Для Claude API или MCP-клиента, который поддерживает token, используйте:

```json
{
  "type": "url",
  "url": "https://your-domain.com/mcp",
  "name": "adforge-mcp",
  "authorization_token": "<PERSONAL_MCP_TOKEN>"
}
```

Нельзя отключать авторизацию на `/mcp` ради удобного подключения.

## ChatGPT

Статус: базовый OAuth 2.1 слой для remote MCP добавлен; ChatGPT Apps/connector всё равно нужно отдельно проверить в Developer Mode.

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

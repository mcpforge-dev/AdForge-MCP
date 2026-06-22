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

Статус: готово для проверки через ChatGPT custom connector, OAuth 2.1, PKCE и Client ID Metadata Document (CIMD).

В ChatGPT форме `Новое приложение` / `Add custom connector`:

1. `Название`: `HolyMedia MCP`.
2. `Подключение`: `URL-адрес сервера`.
3. `URL`: `https://mcp.holymedia.kz/mcp`.
4. `Аутентификация`: `OAuth`.
5. В `Расширенные настройки OAuth` выбрать регистрацию клиента через `Client ID Metadata Document` / `CIMD`, если ChatGPT показывает такой вариант.
6. `Метод аутентификации конечной точки токена`: `none`.
7. `OAuth Client ID` и `OAuth Client Secret` вручную не заполнять, если выбран CIMD.

Как работает подключение:

1. ChatGPT читает protected resource metadata и authorization server metadata HolyMedia MCP.
2. ChatGPT передаёт HTTPS metadata URL как `client_id`.
3. HolyMedia MCP скачивает этот metadata document только с allowlisted доменов ChatGPT/OpenAI, проверяет `redirect_uris` и регистрирует client.
4. При первом использовании ChatGPT открывает вход в HolyMedia MCP.
5. После входа HolyMedia MCP выдаёт authorization code, а ChatGPT меняет его на access token через PKCE.
6. `/mcp` остаётся закрытым: без Bearer token endpoint отвечает `401`.

Если ChatGPT пишет `CIMD недоступен`:

- проверьте, что URL указан именно `https://mcp.holymedia.kz/mcp`, а не `https://mcp.holymedia.kz/`;
- обновите окно создания connector после deploy;
- проверьте `https://mcp.holymedia.kz/.well-known/oauth-authorization-server`: там должно быть `client_id_metadata_document_supported: true`;
- если connector с таким URL уже существует, удалите старую попытку и создайте новую.

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

# Diagnostics для beta MVP

HolyMedia MCP имеет единый слой диагностики для backend, hosted OAuth connections, MCP transport и provider read checks.

## Backend endpoints

- `GET /health` - lightweight healthcheck web process.
- `GET /healthz` - legacy alias для healthcheck.
- `GET /ready` - production-like readiness: beta token, storage, preview-only, diagnostics и MCP transport metadata.
- `GET /api/diagnostics` - общий статус backend, MCP, storage, платформ и next actions.
- `GET /api/diagnostics/platforms` - статусы всех платформ.
- `GET /api/diagnostics/platforms/<platform>` - диагностика одной платформы.
- `GET /api/diagnostics/connections` - состояние `tokens/connections.json` и выбранных аккаунтов.
- `GET /api/diagnostics/mcp` - URL, transport, auth и готовность MCP tools.
- `GET /api/diagnostics/security` - security posture без раскрытия секретов.
- `GET /api/beta/capabilities` - safe beta capabilities summary: hosted model, MCP URL, tools, platform statuses, preview-only posture.

Для безопасной live-проверки provider read API добавьте `?live=1`:

```text
GET /api/diagnostics/platforms/meta_ads?live=1
```

Live-проверка делает только read-запросы:

- selected accounts;
- campaign list;
- basic metrics за вчера.

Write/apply actions не вызываются.

## Dashboard statuses

В Connections отображаются:

- `platform not configured`;
- `env missing`;
- `not connected`;
- `OAuth started`;
- `pending account selection`;
- `connected`;
- `token expired`;
- `reconnect required`;
- `API error`;
- `no accounts selected`;
- `MCP ready`.

Каждая карточка показывает:

- статус;
- количество аккаунтов;
- дату последнего успешного обновления;
- последнюю ошибку;
- отсутствующие env variables;
- кнопки `Reconnect`, `Disconnect`, `Run diagnostics`.

## MCP tool

MCP tool:

```text
run_diagnostics
```

Параметры:

- `live_check=false` по умолчанию;
- `live_check=true` запускает безопасные provider read checks.

Ответ содержит:

- connected platforms;
- доступные аккаунты;
- tools ready;
- tools not ready;
- missing env variables;
- errors to fix;
- next actions.

## Безопасность

Diagnostics никогда не возвращает:

- `access_token`;
- `refresh_token`;
- полный `client_secret`;
- полный `app_secret`;
- `developer_token`;
- bearer token.

Env variables показываются только как `present` или `missing`.

## Нормализованные ошибки

- `OAuthError`;
- `ProviderApiError`;
- `TokenExpiredError`;
- `MissingEnvError`;
- `NoAccountsSelectedError`;
- `McpTransportError`;
- `PreviewOnlyBlockedError`.

В HTTP responses ошибка также получает машинный `code`, например `oauth_error`, `missing_env`, `provider_api_error`, `preview_only_blocked`.

# OAuth readiness для live-теста

Основной домен для всех OAuth redirect:

```text
https://mcp.holymedia.kz
```

Callback URL:

```text
https://mcp.holymedia.kz/oauth/meta/callback
https://mcp.holymedia.kz/oauth/google/callback
https://mcp.holymedia.kz/oauth/tiktok/callback
https://mcp.holymedia.kz/oauth/yandex/callback
```

## Как читать readiness

В `/admin` блок `OAuth setup` показывает:

- `Overall` — готова ли платформа к клиентскому подключению.
- `Env credentials` — есть ли обязательные env на VPS без показа значений.
- `Public OAuth` — открыта ли кнопка подключения клиенту.
- `Authorize URL` — можно ли генерировать authorize URL.
- `Redirect URL` — точный URL, который должен быть прописан у provider.
- `Connected accounts` — сколько аккаунтов уже сохранено в hosted storage.
- `Last attempt` — пока `not_recorded`: аудит OAuth attempts требует отдельной migration.

## Внешние действия

Meta:

- Добавить `https://mcp.holymedia.kz/oauth/meta/callback` в Meta App Dashboard.
- Настроить `AD_MCP_META_OAUTH_APP_ID` и `AD_MCP_META_OAUTH_APP_SECRET`.
- Проверить Ads API permissions и доступ тестового пользователя к Business/Ad Accounts.

Google:

- OAuth Client type: `Web application`.
- Authorized redirect URI: `https://mcp.holymedia.kz/oauth/google/callback`.
- Настроить consent screen, test users, Google Ads API.
- Настроить `AD_MCP_GOOGLE_OAUTH_CLIENT_ID`, `AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET`, `AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN`.

TikTok:

- Добавить `https://mcp.holymedia.kz/oauth/tiktok/callback` в TikTok developer app.
- Проверить app status/scopes/permissions.
- После проверки включить `AD_MCP_TIKTOK_OAUTH_PUBLIC_ENABLED=true`.

Yandex:

- Добавить `https://mcp.holymedia.kz/oauth/yandex/callback` в Yandex OAuth app.
- `client_id` должен быть именно OAuth app id.
- Scope: `direct:api`.
- После проверки включить `AD_MCP_YANDEX_OAUTH_PUBLIC_ENABLED=true`.

## Безопасность

- Не коммитить `.env`, секреты, tokens, DB files, backups или logs.
- Клиенту показывать только продуктовый статус.
- Технические причины показывать только в admin diagnostics/readiness.
- Preview-only должен оставаться включенным.

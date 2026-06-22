# OAuth flows для Google Ads, TikTok Ads и Yandex Direct

Этот документ описывает hosted OAuth-подключения после Meta Ads. Пользователь не скачивает проект локально: он открывает dashboard HolyMedia MCP, нажимает Connect, проходит OAuth и выбирает рекламные аккаунты. Выбранные аккаунты сохраняются в ignored файле `tokens/connections.json`.

## Общие требования

```dotenv
AD_MCP_PUBLIC_BASE_URL=https://mcp.adforge.example
AD_MCP_WEB_API_TOKEN=change-this-beta-token
AD_MCP_CONNECTION_STORE_PATH=tokens/connections.json
```

Callback URL на стороне провайдера должен совпадать с `AD_MCP_PUBLIC_BASE_URL` и redirect path.

После успешного callback сервер по умолчанию возвращает пользователя в dashboard:

```text
/?section=connections&provider=<provider>&status=pending_account_selection&pending_id=<pending-id>
```

Если нужна техническая JSON-проверка callback, можно добавить `response=json` в query.

Dashboard использует общий onboarding API:

```http
GET /api/hosted/connections
GET /api/hosted/oauth/diagnostics
GET /api/hosted/oauth/<provider>/authorize-url
GET /api/hosted/oauth/<provider>/diagnostics
GET /api/hosted/oauth/<provider>/pending?pending_id=<pending-id>
POST /api/hosted/oauth/<provider>/select
POST /api/hosted/connections/disconnect
```

`disconnect` удаляет сохранённые токены и pending selections выбранного провайдера из hosted connection store.

## Google Ads

Переменные:

```dotenv
AD_MCP_GOOGLE_OAUTH_REDIRECT_PATH=/oauth/google/callback
AD_MCP_GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id
AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN=your-google-ads-developer-token
AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID=
AD_MCP_GOOGLE_ADS_API_VERSION=v20
AD_MCP_GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/adwords
```

Redirect URI в Google Cloud OAuth app:

```text
https://mcp.adforge.example/oauth/google/callback
```

Endpoints:

```http
GET /api/hosted/oauth/google/start
GET /oauth/google/callback?code=...&state=...
GET /api/hosted/oauth/google/pending?pending_id=<pending-id>
POST /api/hosted/oauth/google/select
```

После callback сервер меняет `code` на `access_token` и `refresh_token`, вызывает Google Ads `customers:listAccessibleCustomers`, затем best-effort проверяет manager/customer структуру через `customer_client`, показывает safe список customer IDs и сохраняет выбранные аккаунты.

## TikTok Ads

Переменные:

```dotenv
AD_MCP_TIKTOK_OAUTH_REDIRECT_PATH=/oauth/tiktok/callback
AD_MCP_TIKTOK_OAUTH_APP_ID=your-tiktok-app-id
AD_MCP_TIKTOK_OAUTH_APP_SECRET=your-tiktok-app-secret
AD_MCP_TIKTOK_OAUTH_AUTH_URL=https://ads.tiktok.com/marketing_api/auth
AD_MCP_TIKTOK_OAUTH_TOKEN_URL=https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/
AD_MCP_TIKTOK_OAUTH_ADVERTISER_GET_URL=https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/
AD_MCP_TIKTOK_OAUTH_ADVERTISER_ID=
```

Redirect URI в TikTok app:

```text
https://mcp.adforge.example/oauth/tiktok/callback
```

Endpoints:

```http
GET /api/hosted/oauth/tiktok/start
GET /oauth/tiktok/callback?auth_code=...&state=...
GET /api/hosted/oauth/tiktok/pending?pending_id=<pending-id>
POST /api/hosted/oauth/tiktok/select
```

TikTok endpoints оставлены конфигурируемыми, потому что Business API может отличаться по версии и типу приложения. Callback принимает и `auth_code`, и `code`.

## Yandex Direct

Переменные:

```dotenv
AD_MCP_YANDEX_OAUTH_REDIRECT_PATH=/oauth/yandex/callback
AD_MCP_YANDEX_OAUTH_CLIENT_ID=your-yandex-oauth-client-id
AD_MCP_YANDEX_OAUTH_CLIENT_SECRET=your-yandex-oauth-client-secret
AD_MCP_YANDEX_OAUTH_SCOPE=direct:api
AD_MCP_YANDEX_DIRECT_CLIENTS_URL=https://api.direct.yandex.com/json/v5/clients
AD_MCP_YANDEX_DIRECT_LOGIN=your-agency-login
AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN=your-client-login
```

Redirect URI в Yandex OAuth app:

```text
https://mcp.adforge.example/oauth/yandex/callback
```

Endpoints:

```http
GET /api/hosted/oauth/yandex/start
GET /oauth/yandex/callback?code=...&state=...
GET /api/hosted/oauth/yandex/pending?pending_id=<pending-id>
POST /api/hosted/oauth/yandex/select
```

Для Yandex Direct backend пытается получить доступные клиентские логины через `Clients.get`. Если Direct API не возвращает список, используется только явно заданный `AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN`.

## Безопасность

- Все OAuth `state` подписаны HMAC и ограничены TTL.
- Секреты не возвращаются наружу через API.
- Токены и client secrets хранятся только в ignored `tokens/connections.json`.
- Реальные write-действия в beta остаются preview-only.

## Manual checklist

Для live-проверки на реальных приложениях и кабинетах используйте `docs/beta/OAUTH_MANUAL_CHECKLIST_RU.md`.

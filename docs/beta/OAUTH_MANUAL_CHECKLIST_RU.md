# OAuth manual checklist

Этот checklist нужен для ручной проверки OAuth на реальных credentials. Кодовые тесты проверяют URL, state, callback, pending selection и сохранение аккаунтов, но не доказывают, что реальные приложения провайдеров одобрены и токены работают.

## Перед проверкой

1. На сервере задать `AD_MCP_PUBLIC_BASE_URL` с HTTPS-доменом dashboard.
2. Задать `AD_MCP_WEB_API_TOKEN`.
3. Задать OAuth env нужного провайдера.
4. Перезапустить web/API сервис.
5. Открыть diagnostics:

```http
GET /api/hosted/oauth/diagnostics
Authorization: Bearer <beta-token>
```

Статус `configured` означает только то, что нужные env заполнены. Это не live-проверка credentials.

## Meta Ads

Env:

```dotenv
AD_MCP_META_OAUTH_APP_ID=
AD_MCP_META_OAUTH_APP_SECRET=
AD_MCP_META_OAUTH_API_VERSION=v20.0
AD_MCP_META_OAUTH_SCOPES=ads_read,business_management,pages_show_list,pages_read_engagement
```

Meta автоматически включает базовый `public_profile`. Для первой подачи не добавляйте `read_insights`, `instagram_basic` или `ads_management`.

Redirect URL в Meta app:

```text
https://<domain>/oauth/meta/callback
```

Проверка:

1. Dashboard -> Connections -> Meta Ads -> Connect.
2. Пройти Meta OAuth.
3. Вернуться на `/?section=connections&provider=meta_ads&status=pending_account_selection&pending_id=...`.
4. Выбрать ad accounts.
5. Нажать Save selected accounts.
6. Проверить, что Meta Ads показывает `connected`.

Ожидаемый backend flow: code -> user access token -> long-lived token attempt -> `/me/adaccounts` -> pending selection -> save.

## Google Ads

Env:

```dotenv
AD_MCP_GOOGLE_OAUTH_CLIENT_ID=
AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET=
AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN=
AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID=
AD_MCP_GOOGLE_ADS_API_VERSION=v20
AD_MCP_GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/adwords
```

Redirect URL в Google Cloud OAuth client:

```text
https://<domain>/oauth/google/callback
```

Проверка:

1. Dashboard -> Connections -> Google Ads -> Connect.
2. Пройти Google OAuth с consent prompt.
3. Убедиться, что Google вернул `refresh_token`. Если его нет, переподключить с consent prompt.
4. Проверить список `customers:listAccessibleCustomers`.
5. Если используется manager account, проверить, что подтянулись child customer accounts через `customer_client`.
6. Выбрать accounts и сохранить.

Важно: `AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID` нужен для manager/customer структуры, если Google Ads API требует login-customer-id.

## TikTok Ads

Env:

```dotenv
AD_MCP_TIKTOK_OAUTH_APP_ID=
AD_MCP_TIKTOK_OAUTH_APP_SECRET=
AD_MCP_TIKTOK_OAUTH_AUTH_URL=https://ads.tiktok.com/marketing_api/auth
AD_MCP_TIKTOK_OAUTH_TOKEN_URL=https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/
AD_MCP_TIKTOK_OAUTH_ADVERTISER_GET_URL=https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/
AD_MCP_TIKTOK_OAUTH_ADVERTISER_ID=
```

Redirect URL в TikTok app:

```text
https://<domain>/oauth/tiktok/callback
```

Проверка:

1. Dashboard -> Connections -> TikTok Ads -> Connect.
2. Пройти TikTok OAuth.
3. Callback может вернуть `auth_code` или `code`; backend принимает оба.
4. Проверить, что advertiser accounts пришли из token payload или `/oauth2/advertiser/get/`.
5. Если advertiser discovery не вернул список, временно указать `AD_MCP_TIKTOK_OAUTH_ADVERTISER_ID` и повторить.
6. Выбрать advertiser account и сохранить.

## Yandex Direct

Env:

```dotenv
AD_MCP_YANDEX_OAUTH_CLIENT_ID=
AD_MCP_YANDEX_OAUTH_CLIENT_SECRET=
AD_MCP_YANDEX_OAUTH_SCOPE=direct:api
AD_MCP_YANDEX_DIRECT_CLIENTS_URL=https://api.direct.yandex.com/json/v5/clients
AD_MCP_YANDEX_DIRECT_LOGIN=
AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN=
```

Redirect URL в Yandex OAuth app:

```text
https://<domain>/oauth/yandex/callback
```

Проверка:

1. Dashboard -> Connections -> Yandex Direct -> Connect.
2. Пройти Yandex OAuth.
3. Backend меняет code на access/refresh token.
4. Backend пытается получить доступные логины через Direct API `Clients.get`.
5. Если `Clients.get` не вернул список, используется только явно заданный `AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN`.
6. Выбрать login и сохранить.

## Что проверить в storage

Файл `tokens/connections.json` должен оставаться ignored. Внутри допускаются реальные токены, но API/dashboard должны показывать только safe account summary:

- `provider`;
- `accounts`;
- account IDs / logins;
- safe metadata;
- `credentials_present: true`.

Access token, refresh token, app secret, client secret и developer token не должны возвращаться в API responses.

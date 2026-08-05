# Meta OAuth flow

Этот документ описывает первый backend-flow подключения Meta Ads через dashboard.

## Переменные окружения

```dotenv
AD_MCP_PUBLIC_BASE_URL=https://mcp.adforge.example
AD_MCP_META_OAUTH_REDIRECT_PATH=/oauth/meta/callback
AD_MCP_META_OAUTH_APP_ID=your-meta-oauth-app-id
AD_MCP_META_OAUTH_APP_SECRET=your-meta-oauth-app-secret
AD_MCP_META_OAUTH_API_VERSION=v20.0
AD_MCP_META_OAUTH_SCOPES=ads_read,ads_management,business_management,pages_show_list,pages_read_engagement,read_insights,instagram_basic
AD_MCP_META_OAUTH_STATE_TTL_SECONDS=900
```

В Meta App нужно добавить Valid OAuth Redirect URI:

```text
https://mcp.adforge.example/oauth/meta/callback
```

## Endpoints

### Start

```http
GET /api/hosted/oauth/meta/start
Authorization: Bearer <beta-token>
```

Ответ: `302` redirect на Meta OAuth dialog.

### Callback

```http
GET /oauth/meta/callback?code=...&state=...
```

Callback:

- проверяет signed `state`;
- меняет `code` на access token;
- пытается обменять short-lived token на long-lived token;
- получает список ad accounts через `/me/adaccounts`;
- сохраняет discovery как pending selection в `tokens/connections.json`;
- возвращает `pending_id` и safe список аккаунтов.

По умолчанию callback возвращает пользователя в dashboard:

```text
/?section=connections&provider=meta_ads&status=pending_account_selection&pending_id=<pending-id>
```

Для технической JSON-проверки можно добавить `response=json`:

```http
GET /oauth/meta/callback?code=...&state=...&response=json
```

### Pending

```http
GET /api/hosted/oauth/meta/pending?pending_id=<pending-id>
Authorization: Bearer <beta-token>
```

Возвращает safe список найденных аккаунтов без токенов.

### Diagnostics

```http
GET /api/hosted/oauth/meta/diagnostics
Authorization: Bearer <beta-token>
```

Diagnostics проверяет только локальную конфигурацию и storage status. Это не live-проверка реальных Meta credentials.

### Select

```http
POST /api/hosted/oauth/meta/select
Authorization: Bearer <beta-token>
Content-Type: application/json

{
  "pending_id": "<pending-id>",
  "account_ids": ["act_1234567890"]
}
```

После выбора аккаунты сохраняются в hosted connection store и становятся runtime source для MCP tools.

## Security notes

- `state` подписан HMAC и ограничен TTL.
- Access tokens и app secret хранятся только в ignored `tokens/connections.json`.
- API responses возвращают только safe account summary.
- В beta реальные write actions остаются preview-only.

# Environment variables

Все реальные значения хранятся только в env file на VPS/WPS. Для live beta используйте `/etc/adforge-mcp/adforge-mcp.env` на основе [../../deploy/adforge-mcp.env.example](../../deploy/adforge-mcp.env.example). В Git находятся только placeholders.

Diagnostics может показывать env variables только как `present`/`missing`, без значений.

## Core

| Variable | Required | Description |
| --- | --- | --- |
| `AD_MCP_ENV` | Да | Для hosted beta используйте `beta`; `beta` и `production` включают строгие auth checks. |
| `AD_MCP_LOG_LEVEL` | Нет | `INFO` по умолчанию. Для отладки можно временно `DEBUG`, без вывода секретов. |
| `AD_MCP_AUDIT_LOG_PATH` | Нет | Путь к audit log, например `logs/audit.jsonl`. |
| `AD_MCP_WEB_HOST` | Да | В beta на VPS: `127.0.0.1`. |
| `AD_MCP_WEB_PORT` | Да | Внутренний порт dashboard/API, обычно `8765`. |
| `AD_MCP_WEB_API_TOKEN` | Да | Beta token для Web API и hosted MCP bearer auth. |
| `AD_MCP_WEB_MAX_BODY_BYTES` | Нет | Максимальный размер JSON body. |
| `AD_MCP_PREVIEW_ONLY` | Да | Должно быть `true` для beta. |
| `AD_MCP_PUBLIC_BASE_URL` | Да | Публичный base URL dashboard, например `https://your-domain.com`. |
| `AD_MCP_MCP_PUBLIC_URL` | Нет | Полный публичный MCP URL, если он отличается от `AD_MCP_PUBLIC_BASE_URL + /mcp`. |
| `AD_MCP_MCP_ENDPOINT_PATH` | Да | MCP path, обычно `/mcp`. |
| `AD_MCP_MCP_HTTP_HOST` | Да | Внутренний host MCP transport, обычно `127.0.0.1`. |
| `AD_MCP_MCP_HTTP_PORT` | Да | Внутренний port MCP transport, обычно `8766`. |
| `AD_MCP_CONNECTION_STORE_PATH` | Да | Beta OAuth storage, для live VPS обычно `/var/lib/adforge-mcp/connections.json`. |
| `AD_MCP_CONNECTIONS_FALLBACK_TO_LOCAL` | Нет | Для hosted beta лучше `false`, чтобы не опираться на local `ads_config.yaml`. |
| `AD_MCP_CONNECTIONS_CONFIG` | Нет | Local fallback config path для developers/server bootstrap. |
| `AD_MCP_POLICY_CONFIG` | Нет | Safety policy config path. |

## Account, SMTP и avatar upload

| Variable | Required | Description |
| --- | --- | --- |
| `AD_MCP_SMTP_HOST` | Да для email reset | SMTP host. Значение не показывать клиенту. |
| `AD_MCP_SMTP_PORT` | Нет | Обычно `587` для STARTTLS или `465` для SSL. |
| `AD_MCP_SMTP_USERNAME` | Нет | SMTP username, если провайдер требует auth. |
| `AD_MCP_SMTP_PASSWORD` | Да при SMTP auth | SMTP password/app password. Не коммитить и не выводить в логи. |
| `AD_MCP_SMTP_FROM_EMAIL` | Да для email reset | From email, например `noreply@your-domain.com`. |
| `AD_MCP_SMTP_FROM_NAME` | Нет | По умолчанию `HolyMedia MCP`. |
| `AD_MCP_SMTP_USE_TLS` | Нет | `true` для STARTTLS. |
| `AD_MCP_SMTP_USE_SSL` | Нет | `true` для SMTP SSL. Не включать одновременно с TLS, если провайдер этого не требует. |
| `AD_MCP_PASSWORD_RESET_TTL_MINUTES` | Нет | TTL reset-ссылки, по умолчанию `30`. |
| `AD_MCP_PROFILE_UPLOAD_DIR` | Да для avatar upload | Директория аватаров, для VPS обычно `/var/lib/adforge-mcp/uploads`. |
| `AD_MCP_PROFILE_MAX_AVATAR_BYTES` | Нет | Максимальный размер аватара, по умолчанию `2097152` (2 MB). |

Если SMTP не настроен, reset-password endpoint возвращает клиенту понятное сообщение, что отправка письма временно недоступна. Reset token хранится только как hash, действует ограниченное время и используется один раз.

Для upload directory на VPS:

```bash
sudo mkdir -p /var/lib/adforge-mcp/uploads
sudo chown -R adforge:adforge /var/lib/adforge-mcp/uploads
sudo chmod 750 /var/lib/adforge-mcp/uploads
```

## Meta Ads OAuth

| Variable | Required | Description |
| --- | --- | --- |
| `AD_MCP_META_OAUTH_APP_ID` | Да для Meta | Meta app id. |
| `AD_MCP_META_OAUTH_APP_SECRET` | Да для Meta | Meta app secret. |
| `AD_MCP_META_OAUTH_API_VERSION` | Нет | Например `v20.0`. |
| `AD_MCP_META_OAUTH_SCOPES` | Да для Meta | Первая очередь App Review: `ads_read,business_management,pages_show_list,pages_read_engagement`. Базовый `public_profile` Meta добавляет к входу автоматически. |
| `AD_MCP_META_OAUTH_REDIRECT_PATH` | Да для Meta | Обычно `/oauth/meta/callback`. |
| `AD_MCP_META_OAUTH_STATE_TTL_SECONDS` | Нет | OAuth state TTL. |

Redirect URI у Meta:

```text
https://your-domain.com/oauth/meta/callback
```

## Google Ads OAuth

| Variable | Required | Description |
| --- | --- | --- |
| `AD_MCP_GOOGLE_OAUTH_CLIENT_ID` | Да для Google | Google OAuth client id. |
| `AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET` | Да для Google | Google OAuth client secret. |
| `AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN` | Да для Google | Google Ads developer token. |
| `AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Нет | Manager customer id, если нужен. |
| `AD_MCP_GOOGLE_ADS_API_VERSION` | Нет | Например `v20`. |
| `AD_MCP_GOOGLE_OAUTH_SCOPES` | Да для Google | Обычно `https://www.googleapis.com/auth/adwords`. |
| `AD_MCP_GOOGLE_OAUTH_REDIRECT_PATH` | Да для Google | Обычно `/oauth/google/callback`. |

Redirect URI:

```text
https://your-domain.com/oauth/google/callback
```

## TikTok Ads OAuth

| Variable | Required | Description |
| --- | --- | --- |
| `AD_MCP_TIKTOK_OAUTH_APP_ID` | Да для TikTok | TikTok app id. |
| `AD_MCP_TIKTOK_OAUTH_APP_SECRET` | Да для TikTok | TikTok app secret. |
| `AD_MCP_TIKTOK_OAUTH_AUTH_URL` | Нет | TikTok auth URL. |
| `AD_MCP_TIKTOK_OAUTH_TOKEN_URL` | Нет | TikTok token URL. |
| `AD_MCP_TIKTOK_OAUTH_ADVERTISER_GET_URL` | Нет | Advertiser list endpoint. |
| `AD_MCP_TIKTOK_OAUTH_SCOPES` | Нет | Scopes, если требуются приложением. |
| `AD_MCP_TIKTOK_OAUTH_ADVERTISER_ID` | Нет | Fallback advertiser id. |
| `AD_MCP_TIKTOK_OAUTH_REDIRECT_PATH` | Да для TikTok | Обычно `/oauth/tiktok/callback`. |
| `AD_MCP_TIKTOK_OAUTH_PUBLIC_ENABLED` | Нет | `true` только после проверки, что redirect URL добавлен в TikTok developer app. По умолчанию клиентская кнопка скрыта от OAuth-старта. |

Campaigns/metrics для TikTok в текущей beta могут возвращать `not_available`.

Для live-домена TikTok redirect URL должен совпадать символ в символ:

```text
https://mcp.holymedia.kz/oauth/tiktok/callback
```

## Yandex Direct OAuth

| Variable | Required | Description |
| --- | --- | --- |
| `AD_MCP_YANDEX_OAUTH_CLIENT_ID` | Да для Yandex | Yandex OAuth client id. |
| `AD_MCP_YANDEX_OAUTH_CLIENT_SECRET` | Да для Yandex | Yandex OAuth client secret. |
| `AD_MCP_YANDEX_OAUTH_SCOPE` | Да для Yandex | Обычно `direct:api`. |
| `AD_MCP_YANDEX_OAUTH_AUTHORIZE_URL` | Нет | Обычно `https://oauth.yandex.ru/authorize`. |
| `AD_MCP_YANDEX_OAUTH_TOKEN_URL` | Нет | Обычно `https://oauth.yandex.ru/token`. |
| `AD_MCP_YANDEX_DIRECT_CLIENTS_URL` | Нет | Direct API clients endpoint. |
| `AD_MCP_YANDEX_DIRECT_LOGIN` | Нет | Agency/login context. |
| `AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN` | Нет | Client login fallback. |
| `AD_MCP_YANDEX_OAUTH_REDIRECT_PATH` | Да для Yandex | Обычно `/oauth/yandex/callback`. |
| `AD_MCP_YANDEX_OAUTH_PUBLIC_ENABLED` | Нет | `true` только после проверки, что client_id принадлежит OAuth-приложению, client_secret верный, scope `direct:api` разрешен, redirect URI добавлен. |

Campaigns/metrics для Yandex Direct в текущей beta могут возвращать `not_available`.

Для live-домена Yandex redirect URI должен совпадать символ в символ:

```text
https://mcp.holymedia.kz/oauth/yandex/callback
```

## ClickHouse

ClickHouse не является главным фокусом beta. Переменные `AD_MCP_CLICKHOUSE_*` можно оставить выключенными, пока persistence не переводится в production layer.

## Security notes

- Не хранить `.env` в Git.
- Не отправлять `.env` клиенту.
- Не раскрывать `access_token`, `refresh_token`, `client_secret`, `app_secret`, `developer_token`.
- Если секрет попал в чат или log, перевыпустить его.

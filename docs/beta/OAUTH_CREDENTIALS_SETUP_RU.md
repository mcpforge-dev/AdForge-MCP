# OAuth credentials setup для hosted beta

Этот документ описывает, какие OAuth credentials нужны для live hosted beta. Клиент не получает эти секреты и не настраивает их локально: они задаются только в server env на VPS/WPS.

Не вставлять реальные `client_secret`, `app_secret`, `developer_token`, `access_token`, `refresh_token` в Git, docs, screenshots или чат.

## Meta Ads

Для hosted OAuth нужен один актуальный Meta app для AdForge MCP, а не старые per-client long-lived tokens.

Действия:

1. Открыть Meta Developers.
2. Выбрать или создать app для `AdForge MCP`.
3. Проверить продукт Facebook Login / OAuth.
4. Добавить redirect URL:

```text
https://77.240.38.131.sslip.io/oauth/meta/callback
```

5. Включить нужные permissions для чтения рекламных аккаунтов и кампаний.
6. Если старые app secrets или user access tokens были в legacy repo, считать их compromised.
7. Rotate app secret в Meta app.
8. Инвалидировать старые long-lived user access tokens.
9. Добавить credentials только в live env:

```text
AD_MCP_META_APP_ID=<meta-app-id>
AD_MCP_META_APP_SECRET=<meta-app-secret>
AD_MCP_META_REDIRECT_URI=https://77.240.38.131.sslip.io/oauth/meta/callback
```

10. Перезапустить web service и проверить OAuth через dashboard.

Ручная проверка:

- dashboard открывается за beta token gate;
- в `Connections` нажать `Connect` у Meta Ads;
- Meta возвращает callback;
- dashboard показывает pending account selection;
- выбранные accounts сохраняются;
- diagnostics не раскрывает tokens.

## Google Ads

Для Google Ads нужны OAuth Web Client credentials и Google Ads developer token.

Действия:

1. Открыть Google Cloud Console.
2. Выбрать проект AdForge MCP или создать отдельный production-like beta project.
3. Настроить OAuth consent screen.
4. Добавить тестовых пользователей, если app еще в testing mode.
5. Создать OAuth Client ID типа `Web application`.
6. Добавить redirect URL:

```text
https://77.240.38.131.sslip.io/oauth/google/callback
```

7. Убедиться, что Google Ads API включен.
8. Получить Google Ads developer token в Google Ads manager account.
9. Добавить credentials только в live env:

```text
AD_MCP_GOOGLE_CLIENT_ID=<google-oauth-client-id>
AD_MCP_GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
AD_MCP_GOOGLE_REDIRECT_URI=https://77.240.38.131.sslip.io/oauth/google/callback
AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN=<google-ads-developer-token>
AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID=<optional-manager-customer-id>
```

10. Перезапустить web service и проверить OAuth через dashboard.

Важные нюансы:

- Google должен вернуть `refresh_token`; если не вернул, переподключить с consent prompt.
- Для manager account структура customer accounts может требовать `login_customer_id`.
- Developer token не должен показываться в dashboard/API responses.

## TikTok Ads

TikTok OAuth groundwork есть, но campaigns/metrics в beta могут быть limited или `not_available`.

Redirect URL для provider app:

```text
https://77.240.38.131.sslip.io/oauth/tiktok/callback
```

Env на сервере:

```text
AD_MCP_TIKTOK_APP_ID=<tiktok-app-id>
AD_MCP_TIKTOK_APP_SECRET=<tiktok-app-secret>
AD_MCP_TIKTOK_REDIRECT_URI=https://77.240.38.131.sslip.io/oauth/tiktok/callback
```

Проверять как OAuth connection и advertiser account selection. Не обещать в beta полноценные campaigns/metrics, если live API это не подтвердил.

## Yandex Direct

Yandex Direct OAuth groundwork есть, но campaigns/metrics в beta могут быть limited или `not_available`.

Redirect URL:

```text
https://77.240.38.131.sslip.io/oauth/yandex/callback
```

Env на сервере:

```text
AD_MCP_YANDEX_CLIENT_ID=<yandex-client-id>
AD_MCP_YANDEX_CLIENT_SECRET=<yandex-client-secret>
AD_MCP_YANDEX_REDIRECT_URI=https://77.240.38.131.sslip.io/oauth/yandex/callback
```

Если используется agency/client login, хранить login values в env/config без секретов и не коммитить live tokens.

## После изменения env

После обновления `/etc/adforge-mcp/adforge-mcp.env`:

```bash
sudo systemctl restart adforge-mcp-web
sudo systemctl status adforge-mcp-web --no-pager
curl -fsS https://77.240.38.131.sslip.io/ready
```

Затем проверить dashboard:

- `Diagnostics` показывает env present/missing без secret values;
- `Connections` запускает OAuth;
- pending selection работает;
- saved connections показывают только safe account summary.

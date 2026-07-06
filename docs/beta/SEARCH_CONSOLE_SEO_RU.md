# Google Search Console для SEO-отчетов

Раздел `SEO` в dashboard использует отдельное подключение `google_search_console`. Оно не смешивается с `google_ads`, не требует Google Ads developer token и хранит выбранные Search Console properties отдельно от рекламных кабинетов.

## Что включить в Google Cloud

1. Включить Google Search Console API для OAuth project.
2. В OAuth consent screen добавить scope:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

3. В Web OAuth client добавить redirect URI:

```text
https://mcp.holymedia.kz/oauth/google-search-console/callback
https://staging-mcp.holymedia.kz/oauth/google-search-console/callback
```

Для staging лучше использовать отдельный OAuth client или явно помеченные staging credentials. Не копируйте production secrets без необходимости.

## Env

```text
AD_MCP_GOOGLE_OAUTH_CLIENT_ID=
AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET=
AD_MCP_GOOGLE_SEARCH_CONSOLE_SCOPES=https://www.googleapis.com/auth/webmasters.readonly
AD_MCP_GOOGLE_SEARCH_CONSOLE_REDIRECT_PATH=/oauth/google-search-console/callback
```

`AD_MCP_CONNECTION_STORE_PATH` должен указывать на env-specific storage:

- live: `/var/lib/adforge-mcp/connections.json`;
- staging: `/var/lib/adforge-mcp-staging/connections.json`.

## Проверка

1. Войти в dashboard.
2. Открыть раздел `SEO`.
3. Нажать `Подключить Search Console`.
4. Пройти Google OAuth и выбрать Search Console property.
5. Вернуться в раздел `SEO` и проверить:
   - клики;
   - показы;
   - CTR;
   - среднюю позицию;
   - топ запросов;
   - топ страниц;
   - sitemap.

Если подключение есть, но отчет не строится, проверьте права пользователя на выбранную property в Google Search Console и наличие данных за последние 28 дней.

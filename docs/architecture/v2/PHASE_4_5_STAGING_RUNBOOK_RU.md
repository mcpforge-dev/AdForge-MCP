# Phase 4.5: v2 staging и live read-only verification

Документ описывает отдельный v2 staging. Он не заменяет и не использует текущий
v1 staging `staging-mcp.holymedia.kz` и production `mcp.holymedia.kz`.

## Статус инфраструктуры

Рекомендуемый hostname:

`v2-staging-mcp.holymedia.kz`

Требуемая DNS-запись:

```text
Type: A
Name: v2-staging-mcp
Value: 77.240.38.131
TTL: 300
```

На момент подготовки Phase 4.5 hostname не имел A-записи. До её создания нельзя
безопасно выпускать TLS-сертификат или проводить OAuth callback. Не использовать
tunneling-сервисы как замену DNS.

## Изоляция v2 staging

Рекомендуемые отдельные ресурсы на VPS:

```text
project: /opt/holymedia-mcp-v2-staging
env: /etc/holymedia-mcp-v2/v2-staging.env
storage: /var/lib/holymedia-mcp-v2-staging
database: holymedia_mcp_v2_staging
redis: отдельный контейнер/instance с namespace v2-staging
services: holymedia-mcp-v2-staging-web
          holymedia-mcp-v2-staging-api
          holymedia-mcp-v2-staging-worker
logs: /var/log/holymedia-mcp-v2-staging
```

Нельзя переиспользовать v1 paths, DB, systemd units, cookies, sessions,
`connections.json`, provider credentials или пользовательские OAuth tokens.
Ключи `SESSION_HASH_SECRET` и `PROVIDER_CREDENTIAL_ENCRYPTION_KEYS` генерируются
отдельно на сервере и не попадают в Git или отчёт.

## Callback URLs

После создания DNS и настройки reverse proxy добавить в соответствующие
provider consoles ровно эти redirect URIs:

```text
Google Ads:
https://v2-staging-mcp.holymedia.kz/api/v1/oauth/GOOGLE_ADS/callback

Meta Ads:
https://v2-staging-mcp.holymedia.kz/api/v1/oauth/META_ADS/callback
```

URI должен совпадать с `PROVIDER_GOOGLE_REDIRECT_URI`/
`PROVIDER_META_REDIRECT_URI` побайтно, включая схему, hostname, path и отсутствие
лишнего завершающего `/`.

## App-level и user-level secrets

В закрытый v2 staging env допускается положить app-level значения:

- Google OAuth client ID/secret;
- Google Ads developer token;
- Meta App ID/App Secret.

Нельзя копировать или расшифровывать v1 user/connection tokens. Свежий тестовый
пользователь проходит OAuth заново, а credentials сохраняются только через v2
AES-GCM credential vault.

Для Phase 4.5 Meta автоматически запрашиваются только:

`ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`.

`ads_management` и любые дополнительные permissions не включаются в этот
read-only smoke.

## Порядок проверки

1. Создать DNS A-запись и дождаться её публичного резолвинга.
2. Развернуть только v2 Compose/systemd units с отдельным env и DB.
3. Выпустить TLS для `v2-staging-mcp.holymedia.kz`.
4. Создать отдельного v2 test user и workspace.
5. Выполнить новый Google OAuth и проверить discovery, campaigns, metrics и health.
6. Выполнить новый Meta OAuth и проверить permissions, accounts, Business, Pages,
   Page posts/engagement и Page → Instagram.
7. Создать второй workspace и выполнить negative tenant-isolation checks.
8. Убедиться, что ни один write endpoint/commit не вызывается.

## Запрещено

- использовать текущий v1 staging или live DB;
- импортировать v1 sessions, users, connections или provider tokens;
- включать mutations, `ads_management` commit или `preview_only=false`;
- печатать env, tokens, cookies, Authorization headers или ciphertext;
- считать fixture/contract test доказательством live provider read.

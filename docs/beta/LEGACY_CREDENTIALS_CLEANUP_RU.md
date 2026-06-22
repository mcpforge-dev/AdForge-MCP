# Legacy credentials cleanup

Этот документ фиксирует безопасный порядок очистки старых credentials, найденных в legacy-подходе. Цель - не переносить старые токены в hosted beta и не смешивать старую per-account модель с hosted OAuth.

## Что считается legacy risk

Если в старом репозитории или старой `.env` были:

- Meta `app_secret`;
- long-lived Meta `access_token`;
- Google `client_secret`;
- Google Ads `developer_token`;
- OAuth `refresh_token`;
- Yandex/TikTok `client_secret` или `app_secret`;
- любые real account tokens,

считать эти значения compromised, если они когда-либо попадали в Git, screenshots, чат или общие документы.

## Что делать с Meta legacy apps/tokens

1. Найти все старые Meta apps, использованные в per-client setup.
2. Не копировать их secrets в live HolyMedia env.
3. В Meta Developers выполнить app secret rotation.
4. Инвалидировать старые long-lived user access tokens.
5. Создать/выбрать один hosted OAuth app для HolyMedia MCP.
6. Настроить новый redirect URL:

```text
https://77.240.38.131.sslip.io/oauth/meta/callback
```

7. Проверить подключение только через dashboard OAuth.

## Что делать с legacy repo

Если `.env`, `ads_config.yaml` или `tokens/connections.json` были случайно tracked:

```bash
git rm --cached .env ads_config.yaml tokens/connections.json
git status --short
```

Потом убедиться, что `.gitignore` содержит:

```text
.env
ads_config.yaml
tokens/
```

Не делать history rewrite без отдельного решения: это рискованная операция и должна быть согласована отдельно. Даже после удаления из Git считать ранее опубликованные secrets compromised и rotated.

## Что проверять в HolyMedia MCP

- `.env` не tracked.
- `ads_config.yaml` не tracked.
- `tokens/connections.json` не tracked.
- Docs содержат только placeholder values.
- Dashboard/API не возвращают raw tokens.
- Logs не содержат `access_token`, `refresh_token`, `client_secret`, `app_secret`, `developer_token`, `Authorization: Bearer ...`.

## Что можно переносить

Можно переносить:

- platform names;
- account IDs, если они не являются секретами и нужны для диагностики;
- notes по permissions;
- список redirect URLs;
- checklist ручной проверки.

Нельзя переносить:

- raw access/refresh tokens;
- app/client secrets;
- developer token;
- beta token;
- screenshots с открытыми secret values.

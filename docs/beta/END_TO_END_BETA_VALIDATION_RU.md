# End-to-end beta validation HolyMedia MCP

Этот документ нужен для полной проверки hosted beta перед демонстрацией или передачей первому beta-пользователю.

Главная модель остается прежней: клиент не скачивает GitHub-репозиторий и не запускает MCP локально. Оператор разворачивает HolyMedia MCP на VPS/WPS, клиент открывает dashboard, подключает рекламные кабинеты через OAuth и добавляет hosted MCP URL в Codex, Claude или другой MCP-compatible клиент.

## 1. Предварительные условия

- VPS/WPS развернут по [VPS_DEPLOYMENT_RU.md](VPS_DEPLOYMENT_RU.md).
- Для live запуска пройден [LIVE_VPS_RUNBOOK_RU.md](LIVE_VPS_RUNBOOK_RU.md).
- Copy-paste команды сверены с [LIVE_VPS_COMMANDS_RU.md](LIVE_VPS_COMMANDS_RU.md).
- Env file создан на основе [../../deploy/adforge-mcp.env.example](../../deploy/adforge-mcp.env.example).
- HTTPS работает через reverse proxy.
- Web dashboard доступен по публичному URL.
- Hosted MCP endpoint доступен по публичному URL, обычно `https://your-domain.com/mcp`.
- `AD_MCP_WEB_API_TOKEN` задан.
- `AD_MCP_PREVIEW_ONLY=true`.
- `AD_MCP_CONNECTIONS_FALLBACK_TO_LOCAL=false` для hosted beta.
- `tokens/connections.json` существует на сервере или будет создан OAuth-flow.
- Реальные `.env`, OAuth secrets и `tokens/connections.json` не находятся в Git.

## 2. Server smoke

Публичные проверки:

```bash
curl https://your-domain.com/health
curl https://your-domain.com/ready
```

Ожидаемый результат:

- `/health` возвращает `status=ok`;
- `/ready` возвращает `status=ready`;
- `/ready` не содержит access token, refresh token, client secret, developer token или beta token.

Проверки access control:

```bash
curl -i https://your-domain.com/api/diagnostics
curl -i -H "Authorization: Bearer wrong-token" https://your-domain.com/api/diagnostics
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/diagnostics
```

Ожидаемый результат:

- запрос без token отклонен;
- запрос с неверным token отклонен;
- запрос с корректным token возвращает JSON diagnostics.

## 3. Security diagnostics

```bash
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/diagnostics/security
```

Обязательные значения:

- `preview_only=true`;
- `live_writes_enabled=false`;
- `tokens_returned=false`;
- `secrets_redacted=true`;
- `api_auth_required=true`;
- `beta_token_configured=true`.

Если любое из этих значений отличается, beta не готова к демонстрации.

## 4. Capabilities endpoint

```bash
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/beta/capabilities
```

Endpoint должен вернуть безопасную сводку:

- `mode=hosted_beta`;
- `customer_local_setup_required=false`;
- список platforms и MCP tools;
- hosted MCP URL;
- preview-only статус;
- security flags без секретов.

Endpoint не должен возвращать `access_token`, `refresh_token`, `client_secret`, `app_secret`, `developer_token` или bearer token.

## 5. Hosted MCP endpoint

Проверить, что endpoint закрыт без token:

```bash
curl -i https://your-domain.com/mcp
```

Затем проверить через MCP-compatible клиент или smoke script:

```bash
python scripts/smoke_hosted_beta.py \
  --base-url https://your-domain.com \
  --token "<BETA_TOKEN>" \
  --strict-deploy
```

По умолчанию smoke script не запускает live provider checks. Для безопасной read-проверки реальных provider API используется явный флаг:

```bash
python scripts/smoke_hosted_beta.py \
  --base-url https://your-domain.com \
  --token "<BETA_TOKEN>" \
  --strict-deploy \
  --live
```

`--live` должен выполнять только read-checks. Write/apply действия в beta запрещены.

## 6. Dashboard onboarding

Проверить вручную:

1. Открыть dashboard.
2. Ввести beta token, если dashboard запросил доступ.
3. Перейти в `Connections`.
4. Убедиться, что видны Meta Ads, Google Ads, TikTok Ads, Yandex Direct.
5. Проверить статусы: not connected, pending selection, connected, error или reconnect required.
6. Скопировать MCP URL.
7. Запустить diagnostics по платформе.

Ожидаемый результат:

- пользователь понимает, что нужно подключить через OAuth;
- dashboard не просит редактировать `.env` или `ads_config.yaml`;
- connected accounts отображаются без токенов;
- ошибки OAuth понятны человеку.

## 7. OAuth validation

Meta Ads:

- start endpoint редиректит в Meta OAuth;
- callback принимает `code` и `state`;
- state одноразовый и с TTL;
- после callback появляется pending account selection;
- выбранные accounts сохраняются в `tokens/connections.json`;
- dashboard показывает connected/MCP ready.

Google Ads:

- OAuth проходит через Google consent;
- refresh token сохраняется только в server-side storage;
- customer accounts отображаются для выбора;
- developer token берется только из env;
- campaigns/metrics работают только при валидных Google Ads credentials.

TikTok Ads:

- OAuth start/callback доступны;
- advertiser accounts отображаются, если provider credentials валидны;
- campaigns/metrics могут честно вернуть `not_available`.

Yandex Direct:

- OAuth start/callback доступны;
- доступные client logins отображаются, если API credentials валидны;
- campaigns/metrics могут честно вернуть `not_available`.

## 8. MCP client validation

В Codex, Claude или другом клиенте добавить:

- Name: `HolyMedia MCP`;
- URL: `https://your-domain.com/mcp`;
- Auth: `Authorization: Bearer <BETA_TOKEN>`.

Проверочные запросы:

- `Проверь диагностику HolyMedia MCP`;
- `Покажи подключенные рекламные аккаунты`;
- `Покажи кампании Meta Ads`;
- `Покажи кампании Google Ads за последние 7 дней`;
- `Покажи базовые метрики за вчера`;
- `Сделай preview изменения бюджета кампании, но ничего не применяй`.

Ожидаемый результат:

- diagnostics возвращает понятный статус;
- accounts берутся из hosted OAuth connections;
- campaigns/metrics не подменяются fake data;
- preview response содержит `will_apply=false`.

## 9. Preview-only validation

Проверить через MCP tools:

- `preview_pause_campaign`;
- `preview_resume_campaign`;
- `preview_change_campaign_budget`;
- `preview_change_campaign_name`;
- `commit_preview`.

Ожидаемый результат:

- preview tools читают текущее состояние, если оно доступно;
- реальный write endpoint provider не вызывается;
- `will_apply=false`;
- `commit_preview` заблокирован для beta;
- ответ объясняет, что beta работает в preview-only mode.

## 10. Финальная проверка перед demo

Перед demo должны быть зелены:

- unit tests;
- compileall;
- dashboard JS syntax check;
- `scripts/smoke_mcp_beta.py`;
- `scripts/smoke_hosted_beta.py --help`;
- deployed smoke без `--live`;
- staged secret scan.

Если live credentials есть, отдельно пройти live read-checks с `--live`. Если credentials нет, не имитировать успех: отметить ручную проверку как blocked by credentials.

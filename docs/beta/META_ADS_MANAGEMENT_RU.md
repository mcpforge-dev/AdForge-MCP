# Meta ads_management: безопасное создание и редактирование

HolyMedia MCP поддерживает управляемый workflow реальных Meta Ads изменений, но он выключен по умолчанию. Глобальный `AD_MCP_PREVIEW_ONLY=true` сохраняется. Реальная запись доступна только через отдельный инструмент подтверждения, разрешённый серверным feature flag и allowlist рекламных кабинетов.

## Поддерживаемые операции

Preview-инструменты:

```text
preview_meta_create_campaign
preview_meta_create_adset
preview_meta_create_creative
preview_meta_create_ad
preview_meta_update_campaign
preview_meta_update_adset
preview_meta_update_ad
```

Commit-инструмент:

```text
commit_meta_confirmed_write
```

Новые campaign, adset и ad всегда создаются в статусе `PAUSED`. Поддерживается создание creative через `object_story_spec`, `asset_feed_spec` или существующий `object_story_id`. Удаление, архивирование и bulk-write в этом workflow не реализованы.

Бюджеты и ставки передаются целыми числами в minor currency units рекламного кабинета Meta. Например, для валюты с двумя знаками после запятой значение `2500` означает `25.00` в валюте кабинета. Перед commit проверяйте currency и итоговый provider payload в preview.

## Серверные условия

Сначала permission должен быть настроен и доступен приложению в Meta App Dashboard. Затем на нужной среде:

```env
AD_MCP_META_ADS_MANAGEMENT_OAUTH_ENABLED=true
AD_MCP_META_CONFIRMED_WRITE_ENABLED=true
AD_MCP_META_CONFIRMED_WRITE_ALLOWED_ACCOUNT_IDS=act_<test_account_id>
AD_MCP_META_CONFIRMED_WRITE_ALLOWED_OBJECT_IDS=<paused_test_campaign_id>
AD_MCP_META_CONFIRMED_WRITE_ALLOWED_ACTIONS=change_name
AD_MCP_META_CONFIRMED_WRITE_REQUIRE_PAUSED_OBJECTS=true
AD_MCP_PREVIEW_ONLY=true
```

После изменения OAuth env пользователь должен переподключить Meta. До commit сервер вызывает `get_meta_oauth_permissions` и требует фактически выданный `ads_management`.

## Workflow

1. Вызвать один preview-инструмент.
2. Проверить account ID, object type, endpoint, body, before/requested diff, статус и бюджет.
3. Получить строку `CONFIRM META WRITE <preview_token>`.
4. Передать её без изменений в `commit_meta_confirmed_write`.
5. Сервер повторно проверяет env, account/object/operation allowlist, account binding и `ads_management`.
6. Preview token потребляется один раз, выполняется один POST в Meta API.
7. Созданный или изменённый объект перечитывается; ответ содержит `verified_by_reread`, `verified_fields` и `unverified_fields`.

Без точного подтверждения, permission, allowlist или feature flag commit возвращает `blocked`. Service token со scope `adforge:mcp:read` не может вызывать write-инструменты.

## Безопасная App Review демонстрация

Используйте отдельную PAUSED test campaign и тестовый adset. Первый ролик должен показывать низкорисковое переименование:

1. Read campaign и её статус `PAUSED`.
2. `preview_meta_update_campaign` с новым тестовым названием.
3. Commit с неправильным confirmation: сервер возвращает `blocked`.
4. Новый preview и точное подтверждение.
5. `commit_meta_confirmed_write` и повторное чтение с новым названием.

Создание демонстрируйте отдельной цепочкой campaign → adset → creative → ad. Каждый объект остаётся `PAUSED`; запуск доставки в App Review ролике не требуется.

# Meta App Review: staging-проверка HolyMedia MCP

Документ описывает проверяемые read-сценарии и отдельный низкорисковый write-сценарий. Production не включается этим runbook: `AD_MCP_PREVIEW_ONLY=true` остаётся обязательным, а `commit_preview` всегда блокирует внешние изменения.

## OAuth permissions

Базовый OAuth запрашивает четыре read-only permission:

```text
ads_read
business_management
pages_show_list
pages_read_engagement
```

`public_profile` является базовым permission Meta Login и добавляется Meta автоматически. `pages_show_list` используется для `/me/accounts`, `pages_read_engagement` для Page, публикаций и доступных базовых engagement-полей, `business_management` для `/me/businesses` и Business asset edges. `read_insights` и `instagram_basic` не добавляются в OAuth URL. Для отдельного ролика `ads_management` добавляется только при `AD_MCP_META_ADS_MANAGEMENT_OAUTH_ENABLED=true`.

После OAuth выберите нужный рекламный кабинет. Сервис сохраняет связь workspace → Meta account, а также безопасные идентификаторы найденных Business/Page/Instagram. Page Access Token сохраняется только в закрытом server-side storage и никогда не возвращается MCP-клиенту.

## Повторное подключение

1. Откройте staging dashboard: `https://staging-mcp.holymedia.kz`.
2. В рабочем пространстве откройте «Подключения» → Meta Ads → «Переподключить».
3. В окне Meta подтвердите четыре permissions из списка выше и `ads_management`, если включён соответствующий App Review сценарий; сообщения `Invalid Scopes` быть не должно.
4. Выберите Business Portfolio и подтвердите доступ к Page «Личное страхование», если Meta показывает выбор объектов.
5. Выберите рекламный аккаунт Saqta Market и завершите OAuth.
6. Обновите страницу подключений. В безопасной сводке должны быть только account name/id, permissions и `credentials_present`; токены в UI не показываются.
7. Для App Review записи используйте AI-клиент и инструменты ниже. Не вставляйте access token в чат, скриншоты или ролики.

Если permission не отображается, проверьте, что он добавлен в Meta App Dashboard и пользователь является tester/developer/admin приложения в development mode. В production Meta App Review permission должен быть одобрен отдельно.

## Read tools

Новые инструменты вызывают Meta Graph API в реальном времени:

```text
get_meta_oauth_permissions
list_meta_businesses
get_meta_business
list_business_ad_accounts
list_business_pages
list_meta_pages
get_meta_page
list_page_posts
get_page_post
get_page_post_engagement
get_page_instagram_account
```

Каждый затронутый ответ содержит `source_api`, `real_data`, `data_status`, `fetched_at`. Page больше не зависит от Instagram-полей: сначала выполняется `/me/accounts`, затем `/{page_id}/published_posts` с Page Access Token. Публикации нормализуются в `post_id`, `text`/`description`, `created_time`, `permalink` и доступные `comments`/`reactions`/`shares`. Page Insights не запрашиваются, поэтому `read_insights` для этого сценария не нужен. Связанный Instagram проверяется отдельно и не блокирует Page-сценарий.

## ads_management workflow

`ads_management` включается отдельным feature flag и остаётся ограничен точным account/object/action allowlist. Глобальный `AD_MCP_PREVIEW_ONLY=true` не отключается, общий `commit_preview` остаётся заблокирован. Полный безопасный workflow описан в `META_ADS_MANAGEMENT_RU.md`.

Для Page-проверки `list_page_posts` использует `/{page_id}/published_posts`: этот edge возвращает публикации, созданные самой Page, и не требует `pages_read_user_content`.

```text
AD_MCP_META_ADS_MANAGEMENT_OAUTH_ENABLED=true
AD_MCP_META_CONFIRMED_WRITE_ENABLED=true
AD_MCP_META_CONFIRMED_WRITE_ALLOWED_ACCOUNT_IDS=act_<test_account_id>
AD_MCP_META_CONFIRMED_WRITE_ALLOWED_OBJECT_IDS=<paused_test_campaign_id>
AD_MCP_META_CONFIRMED_WRITE_ALLOWED_ACTIONS=change_name
AD_MCP_META_CONFIRMED_WRITE_REQUIRE_PAUSED_OBJECTS=true
AD_MCP_PREVIEW_ONLY=true
```

Preview возвращает точный diff и строку `CONFIRM META WRITE <preview_token>`. Без отдельного явного ответа пользователя с этой строкой `commit_meta_confirmed_write` не вызывается. После подтверждения сервер повторно проверяет permission, allowlist и статус `PAUSED`, отправляет в Meta только поле `name`, перечитывает кампанию и возвращает `verified_by_reread=true`.

Не используйте активную рабочую кампанию Saqta Market. Если в staging нет отдельной paused campaign, commit-тест считается заблокированным до её создания в Meta Ads Manager.

## App Review demo scripts

Можно записывать после успешного staging smoke:

1. `ads_read`: подключённый Saqta Market → campaigns → ID, name, status, objective, budget → metrics за 30 дней.
2. `business_management`: `list_meta_businesses` → `get_meta_business` → Business name и Business ID.
3. Business assets: `list_business_ad_accounts` и `list_business_pages` → реальные связанные объекты.
4. `pages_read_engagement`: `list_meta_pages` → `get_meta_page` → `list_page_posts` → `get_page_post_engagement`.
5. Допустимая Instagram linkage: `get_page_instagram_account` → связанный Instagram ID либо честный `additional_permission_required`; username и профиль в текущем ролике не показывать.

6. `ads_management`: `get_campaign` → `preview_meta_update_campaign` → отдельное подтверждение пользователя → `commit_meta_confirmed_write` → `get_campaign`.

В каждом ролике оставьте видимыми название инструмента, объект, безопасный ID, ответ Meta и поля `source_api`, `real_data`, `data_status`, `fetched_at`. Не показывайте tokens, app secret, env, cookies или полные server logs.

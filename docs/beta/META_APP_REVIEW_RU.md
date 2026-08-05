# Meta App Review: staging-проверка HolyMedia MCP

Документ описывает проверяемые read-сценарии и отдельный низкорисковый write-сценарий. Production не включается этим runbook: `AD_MCP_PREVIEW_ONLY=true` остаётся обязательным, а `commit_preview` всегда блокирует внешние изменения.

## OAuth permissions

Для staging OAuth после выкладки нужно переподключить Meta:

```text
ads_read
ads_management
business_management
pages_show_list
pages_read_engagement
read_insights
instagram_basic
```

`pages_show_list` используется для `/me/accounts`, `pages_read_engagement` для Page и публикаций, `read_insights` для доступных engagement insights, `business_management` для `/me/businesses` и Business asset edges. `ads_management` нужен только для отдельного подтверждённого App Review test commit. `instagram_basic` нужен для чтения связанного Instagram Professional Account через Page.

После OAuth выберите нужный рекламный кабинет. Сервис сохраняет связь workspace → Meta account, а также безопасные идентификаторы найденных Business/Page/Instagram. Page Access Token сохраняется только в закрытом server-side storage и никогда не возвращается MCP-клиенту.

## Повторное подключение

1. Откройте staging dashboard: `https://staging-mcp.holymedia.kz`.
2. В рабочем пространстве откройте «Подключения» → Meta Ads → «Переподключить».
3. В окне Meta подтвердите все семь permissions из списка выше.
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

Каждый затронутый ответ содержит `source_api`, `real_data`, `data_status`, `fetched_at`. Page и Instagram больше не читаются через `/act_{account_id}/instagram_accounts`: сначала `/me/accounts`, затем Page Access Token и `/{page_id}?fields=instagram_business_account{...}`.

## Safe ads_management workflow

Глобальный preview-only не отключается. Staging может включить отдельный флаг только после создания приостановленной тестовой кампании:

```text
AD_MCP_META_APP_REVIEW_COMMIT_ENABLED=true
AD_MCP_META_APP_REVIEW_ALLOWED_ACCOUNT_ID=<staging test account id>
AD_MCP_META_APP_REVIEW_ALLOWED_OBJECT_IDS=<paused test campaign id>
AD_MCP_META_APP_REVIEW_ALLOWED_ACTIONS=change_name
```

При этом должны быть staging-only значения `env=staging` и `AD_MCP_PREVIEW_ONLY=true`. Preview возвращает точный diff и строку `CONFIRM <preview_token>`. Без этой строки новый `commit_meta_app_review_preview` возвращает `blocked`. После подтверждения сервер проверяет allowlist, выполняет ровно одно поле через Meta Marketing API, перечитывает кампанию и возвращает `verified_by_reread=true`. Общий `commit_preview` остаётся заблокированным.

Не используйте активную рабочую кампанию Saqta Market. Если в staging нет отдельной paused campaign, commit-тест считается заблокированным до её создания в Meta Ads Manager.

## App Review demo scripts

Можно записывать после успешного staging smoke:

1. `ads_read`: подключённый Saqta Market → campaigns → ID, name, status, objective, budget → metrics за 30 дней.
2. `business_management`: `list_meta_businesses` → `get_meta_business` → Business name и Business ID.
3. Business assets: `list_business_ad_accounts` и `list_business_pages` → реальные связанные объекты.
4. `pages_read_engagement`: `list_meta_pages` → `get_meta_page` → `list_page_posts` → `get_page_post_engagement`.
5. Instagram linkage: `get_page_instagram_account` → связанный Instagram ID и username.
6. `ads_management`: только paused test campaign → preview diff → попытка commit без confirmation (blocked) → новый preview → exact confirmation → commit → reread с фактическим новым названием.

В каждом ролике оставьте видимыми название инструмента, объект, безопасный ID, ответ Meta и поля `source_api`, `real_data`, `data_status`, `fetched_at`. Не показывайте tokens, app secret, env, cookies или полные server logs.

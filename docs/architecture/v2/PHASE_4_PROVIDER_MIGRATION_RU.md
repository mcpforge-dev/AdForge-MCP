# Phase 4: реальная миграция Google Ads и Meta Ads

В v2 provider-specific HTTP находится в `apps/api/src/providers/adapters/`. Core API вызывает общий `ProviderReadAdapter`, а Google GAQL и Meta Graph paths остаются внутри соответствующего adapter. Внешний API принимает только server-validated workspace, connection, selected enabled account и абсолютный date range.

## Security boundary

OAuth state, session binding, encryption-at-rest, refresh lock и tenant authorization переиспользуют Phase 2/3. Provider access/refresh tokens расшифровываются только в API runtime. Они не возвращаются в DTO, не попадают в fixtures, UI, metrics или logs. Phase 4 не открывал широкие provider writes. В текущем Phase A controlled Meta mutation boundary находится в MCP preview service: default `preview_only` остаётся включённым, а реальный commit требует отдельного confirmed-write флага, write scope и allowlists для account/object/operation. Live mutation не считается проверенной автоматически.

## Google

Используются `customers:listAccessibleCustomers`, `customer_client` и Google Ads REST `searchStream`. `PROVIDER_GOOGLE_DEVELOPER_TOKEN` и OAuth client являются application-level env secrets. `PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID` задаёт manager context, а selected external account остаётся target customer ID. Account statuses `REMOVED` нормализуются как `disabled`, а не как системная ошибка.

## Meta

По умолчанию запрашиваются только `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`. `ads_management` добавляется лишь при `PROVIDER_META_ADS_MANAGEMENT_OAUTH_ENABLED=true`; `read_insights` и `instagram_basic` автоматически не добавляются. Pages читаются через `/me/accounts`, публикации через Page Access Token и `/{page}/published_posts`, Instagram через Page `instagram_business_account`.

## Live verification

Live smoke намеренно не включён в обязательный CI и не получает production credentials. Для него должны быть отдельно предоставлены v2 env secrets и изолированная тестовая connection; до этого статусы матрицы остаются `IMPLEMENTED`/`TESTED`, а production v1/live/staging не затрагиваются.

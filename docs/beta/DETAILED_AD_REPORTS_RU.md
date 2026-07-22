# Детальные read-only отчёты Google Ads и Meta Ads

Расширенные отчёты дополняют `get_basic_metrics` и не выполняют write-действия. Они совместимы с обязательным режимом `preview_only`.

## Доступные MCP tools

- `list_detailed_ad_report_types(platform)` — список доступных типов отчёта.
- `get_google_ads_detailed_report(...)` — детальные Google Ads отчёты.
- `get_meta_ads_detailed_report(...)` — детальные Meta Ads отчёты.

## Google Ads

Типы `report_type`:

- `search_terms` — поисковые запросы, статус, match type и метрики;
- `keywords` — ключи, match type, статус, quality score и метрики;
- `ads` — объявления, URL, RSA headlines/descriptions и метрики;
- `ad_groups` — группы, статус, ставки и метрики;
- `bidding` — стратегия ставок и бюджет кампании;
- `conversions` — разбивка по conversion action, включая доступные импорты GA4;
- `auction_insights` — конкуренты и auction metrics;
- `change_history` — изменения за последние 30 дней;
- `account_budget` — account-level budget для поддерживаемых billing setup.

Для отчётов с метриками нужны `start_date` и `end_date`. Можно передать `campaign_id`, `ad_group_id` и `limit`.

Google не предоставляет универсальный «остаток кошелька» для каждого типа оплаты. `account_budget` чаще доступен при consolidated/monthly invoicing. Auction Insights появляется только у подходящих кампаний с достаточным объёмом данных.

## Meta Ads

Типы `report_type`:

- `actions` — полный actions breakdown, Results по настроенным `action_metrics`, переписки и cost per action;
- `video` — plays, ThruPlay и просмотры 25/50/75/95/100%;
- `engagement` — reactions/comments/shares/saves/follows из actions breakdown;
- `creatives` — тексты, CTA, destination/story spec, image/video/thumbnail metadata;
- `ads`, `adsets` — объявления и группы, включая targeting и optimization goal;
- `audiences`, `saved_audiences` — custom/lookalike/saved audiences при наличии прав;
- `pixels`, `custom_conversions`, `activities` — связанные объекты;
- `billing` — balance, spend cap, amount spent и доступные payment metadata;
- `connected_assets` — страницы, Instagram, pixels и conversions с частичным результатом.

Параметр `query` для `creatives` ищет по текстам и metadata. Он не выполняет распознавание содержимого изображения или видео. Для визуального поиска нужен отдельный индекс изображений и vision-анализ с контролем доступа.

Если Meta не разрешает отдельный edge, например `instagram_accounts`, `connected_assets` возвращает остальные данные, `partial=true` и безопасное предупреждение без токенов.

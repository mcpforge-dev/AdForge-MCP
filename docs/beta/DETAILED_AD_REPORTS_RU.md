# Детальные рекламные отчёты: статус V2

Этот документ фиксирует фактическое состояние V2, чтобы capability catalog не
выдавал будущие provider adapters за готовую live-функцию.

## Сейчас доступно

V2 предоставляет общий read API и MCP-инструменты для:

- рекламных кабинетов и их статуса;
- списка кампаний;
- campaign status/objective/budget;
- расхода, показов, кликов, CTR, CPC, CPM, конверсий и стоимости конверсии,
  когда конкретный provider возвращает эти поля;
- Google Ads hierarchy/diagnostics;
- Meta Business, Pages, Page posts и Page → Instagram, если выданные
  permissions позволяют прочитать объект;
- безопасной provenance: `source_api`, `real_data`, `data_status`,
  `fetched_at` в соответствующих provider responses.

## Зарегистрированные compatibility names

Имена `list_detailed_ad_report_types` и `get_detailed_ad_report_types`
сохранены в MCP surface V1. Сейчас они возвращают только поддержанный тип
`campaign_performance` и не делают вид, что детальные provider reports уже
доступны.

## Пока не реализовано в V2

- Google search terms, keywords, ads, ad groups, bidding, conversions
  breakdown, auction insights, change history и account budget;
- Meta actions breakdown, video, engagement, creatives, adsets/targeting,
  audiences, pixels, billing и visual creative search;
- полноценные read adapters для Yandex Direct и TikTok Ads.

Отсутствующие возможности должны возвращать честный `unsupported` или
`additional_permission_required`, а не локальные snapshots, fixture или
нулевые метрики.

## Следующий implementation block

Добавлять report types по одному provider-backed adapter с контрактом,
санитизацией ошибок, pagination, provenance и отдельными contract/integration
тестами. До live-проверки capability остаётся `IMPLEMENTED`/`TESTED`, но не
`LIVE_READ_VERIFIED`.

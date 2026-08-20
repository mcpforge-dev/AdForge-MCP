# Семантика метрик providers

V2 возвращает деньги как decimal string в валюте аккаунта. Google `cost_micros` делится на 1 000 000. Meta `spend` уже является валютной суммой. Никакие расчёты не выполняются через денежный floating-point API наружу.

| Нормализованное поле | Google Ads                                           | Meta Ads                                                                                     | Nullable/оговорка                                      |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `spend`              | `metrics.cost_micros / 1e6`                          | `insights.spend`                                                                             | null, если provider не вернул сумму                    |
| `impressions`        | `metrics.impressions`                                | `insights.impressions`                                                                       | целое, null при отсутствии                             |
| `clicks`             | `metrics.clicks`                                     | `insights.clicks`                                                                            | целое, null при отсутствии                             |
| `ctr`                | `metrics.ctr`, иначе clicks/impressions              | `insights.ctr`, иначе clicks/impressions                                                     | доля 0..1, не проценты                                 |
| `cpc`                | `metrics.average_cpc / 1e6`, иначе spend/clicks      | `insights.cpc`, иначе spend/clicks                                                           | валюта аккаунта                                        |
| `cpm`                | производное spend/impressions*1000                   | `insights.cpm`, иначе производное                                                            | валюта аккаунта                                        |
| `conversions`        | `metrics.conversions`                                | сумма только action types: `lead`, `offsite_conversion`, `purchase`, `complete_registration` | Meta null, если actions не содержит однозначный action |
| `conversionValue`    | `metrics.conversions_value`                          | не нормализуется без однозначной семантики                                                   | null для Meta                                          |
| `costPerConversion`  | `metrics.cost_per_conversion` либо spend/conversions | производное только при доступных однозначных conversions                                     | валюта аккаунта                                        |

Период приходит в v2 как абсолютный `YYYY-MM-DD` `startDate/endDate`. Относительные фразы (`last 7 days`, `previous 7 days`) должны быть разрешены выше provider-слоя и переданы сюда уже нормализованными. Временная зона берётся из выбранного advertising account, когда она доступна.

Meta actions нельзя называть «конверсиями» без явного списка типов. Наличие `ads_read` не означает доступность всех действий Insights.

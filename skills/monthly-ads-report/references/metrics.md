# Определения метрик

Использовать определения платформы и сохранять исходное имя метрики. Пользовательские названия разрешать только после явного сопоставления.

## Формулы

- `CTR = clicks / impressions × 100%`
- `CPC = spend / clicks`
- `CPM = spend / impressions × 1000`
- `CPL = spend / leads`
- `CPA = spend / attributed_actions`
- `CVR = attributed_actions / clicks × 100%`
- `qualification_rate = qualified_leads / leads × 100%`
- `appointment_rate = appointments / leads × 100%`
- `show_rate = visits / appointments × 100%`
- `sales_rate = sales / leads × 100%`
- `ROAS = attributed_revenue / ad_spend`
- `ROMI = (attributed_revenue - marketing_cost) / marketing_cost × 100%`

## Ограничения

- Не рассчитывать показатель при нулевом или неизвестном знаменателе.
- Не использовать `results` Meta как универсальные лиды без разбивки по типу результата.
- Не суммировать Google conversions с Meta conversations без отдельного общего определения.
- Указывать, включены ли налоги, комиссии агентства и производство креативов.
- Для пересчёта валюты указывать источник курса и дату.
- Для сравнения сохранять одинаковое окно атрибуции либо явно показывать различие.

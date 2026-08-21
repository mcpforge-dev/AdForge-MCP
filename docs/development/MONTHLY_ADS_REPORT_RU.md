# Клиентский отчёт по рекламе V2

В V2 отчёт строится только из выбранного workspace, подключённого provider и
включённого рекламного кабинета. Google Ads и Meta Ads не смешиваются.

## Что реализовано

- JSON-отчёт с периодом, KPI, кампаниями, provenance и краткими
  evidence-based выводами в поле `insights`;
- DOCX-отчёт с обложечным блоком, KPI-таблицей, CPM, ценностью конверсий,
  таблицей кампаний, источником данных и ограничениями;
- сортировка кампаний по расходу и ограничение таблицы 50 строк с явным
  сообщением о сокращении списка;
- безопасный fallback `Нет данных`, если provider не вернул показатель;
- entitlement-проверка для новых и legacy compatibility routes;
- отчёт не содержит OAuth-токены, API keys, cookies или другие секреты.

## Endpoints

- `GET /api/v1/workspaces/:workspaceId/reports/performance` — JSON;
- `GET /api/v1/workspaces/:workspaceId/reports/performance.docx` — DOCX;
- `GET|POST /api/meta/skills/collect-report` — V1-compatible JSON;
- `GET|POST /api/meta/skills/collect-report.docx` — V1-compatible DOCX.

Запрос содержит `accountId`/`account_id`, `startDate`/`start_date` и
`endDate`/`end_date`. Сервер заново проверяет workspace, connection, enabled
account и billing entitlement; frontend не может подменить источник данных.

## Форматы и ограничения

PDF-презентация 16:9, автоматическое сравнение периодов и детальные отчёты по
поисковым запросам, ключам, объявлениям, auction insights и Meta creatives не
считаются реализованными возможностями V2 на текущем этапе. Их нужно добавлять
отдельными provider-backed adapters, а не заполнять fixture или seeded данными.

Текущий DOCX использует абсолютный период и исходные нормализованные поля
provider contract. Причины изменений не придумываются: выводы описывают только
фактически полученные расход, показы, клики, CTR и конверсии.

## Roadmap

Следующий report block: сравнение периодов в одном документе, async artifact
storage, затем PDF после выбора и проверки production-grade PDF renderer.

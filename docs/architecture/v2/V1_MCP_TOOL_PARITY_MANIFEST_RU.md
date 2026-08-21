# V1 MCP tool parity manifest

Inventory получен из V1 AST builders. Он фиксирует внешний contract до
blue/green cutover, но не является заявлением о том, что все 134 инструмента
уже реализованы в V2.

## Источники

- V1 registration: `src/ad_mcp/server.py`;
- V1 builders: `src/ad_mcp/tools/*.py`;
- V2 transport: `apps/api/src/mcp/mcp.controller.ts`;
- V2 authorization: `apps/api/src/mcp/mcp.service.ts` и
  `apps/api/src/service-tokens/`.

## Группы

В исходном V1 inventory 134 имени. Среди них discovery/account reads,
campaign reads, metrics, reports, Meta Business/Page/Instagram, SEO, site
analysis, preview/write intents и skill presets.

## V2 status

### Реализовано и server-authorized

- provider discovery и capability metadata;
- accounts, account status/summary, campaigns, campaign statuses;
- basic metrics и performance report;
- `compare_periods` с абсолютными и процентными изменениями;
- executive/status/top-performer/spend overview aliases;
- Google Ads и Meta Ads read adapters;
- Meta Business, Pages, posts, engagement и Page -> Instagram;
- Search Console properties и report;
- site analysis через live HTTP fetch;
- report collection и DOCX export;
- scoped service tokens и tenant/account restrictions;
- preview -> confirmation -> commit policy boundary.

### Реализовано как policy boundary, но запись выключена

- `preview_change_campaign_name`;
- `preview_pause_campaign`;
- `preview_resume_campaign`;
- `preview_change_campaign_budget`;
- `confirm_preview`;
- `commit_preview` и `commit_meta_confirmed_write`.

Commit требует `adforge:mcp:write`, явное подтверждение и отдельную policy
конфигурации. Даже при наличии scope текущий provider mutation adapter не
вызывается: `preview_only` остаётся включённым.

### Не выдаётся за готовую функцию

- подробные ad/adset/ad-group/keyword reports;
- billing/balance и auction insights;
- creative search/visual analysis;
- V1 skill catalog, budget summary и candidate skills;
- PDF report export;
- create/update/delete рекламных объектов;
- полноценная background provider sync.

Эти имена не должны появляться в `tools/list`, пока для них нет реального
adapter, контракта, tenant authorization и regression tests. Placeholder
ответы запрещены.

## Acceptance rule

Инструмент считается перенесённым только после проверки input contract,
server-side authorization, workspace/account isolation, response semantics,
safe error handling и regression tests. Наличие похожего имени в inventory не
является доказательством parity.

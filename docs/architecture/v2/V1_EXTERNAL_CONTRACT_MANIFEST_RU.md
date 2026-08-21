# V1 external contract manifest

Документ фиксирует внешний контракт, который V2 должна сохранить до in-place
production cutover. V2 не требует нового hostname, DNS-записи или нового OAuth
приложения.

## Стабильные публичные маршруты

Сохраняются через compatibility controllers или соответствующие V2 модули:

- `GET /health` и `GET /ready`;
- `GET /.well-known/oauth-protected-resource`;
- `GET /.well-known/oauth-authorization-server`;
- `GET /privacy` и `GET /terms`;
- `GET /oauth/google/callback`;
- `GET /oauth/meta/callback`;
- `GET /oauth/yandex/callback`;
- `GET /oauth/tiktok/callback`;
- `GET /oauth/google-search-console/callback`;
- `GET /auth/google/start` и `GET /auth/google/callback`;
- `GET /oauth/authorize` и `POST /oauth/token`;
- `POST /mcp` и защищённый `GET /mcp`.

Callback URLs остаются частью настроек Google, Meta, Yandex и TikTok. Новый
redirect URL для V2 не создаётся. Callback принимает только server-side state,
проверяет сессию, workspace, provider и одноразовость операции.

## Dashboard compatibility routes

В V2 уже есть compatibility surface для:

- `/api/auth/*`, `/api/me`, `/api/profile*`;
- `/api/mcp-token*`, `/api/mcp-oauth-client*`, `/api/hosted/*`;
- `/api/connection-requests*`;
- `/api/admin/users*`, `/api/admin/diagnostics`, `/api/admin/connection-requests*`;
- `/api/diagnostics*` и `/api/beta/capabilities`;
- `/api/seo/*`;
- `/api/site/analyze`, `/api/site/history`, `/api/site/report.docx`;
- `/api/meta/skills/collect-report*`;
- provider-neutral V2 report DOCX routes.

Остаются отдельными parity-задачами:

- V1 skill catalog и budget/candidate endpoints;
- старый PDF export;
- admin OAuth pending/select flow для ручного Meta onboarding;
- маршруты detailed ad reports, пока соответствующая нормализация не готова.

## MCP transport invariants

- `/mcp` без bearer token возвращает `401`;
- токен проверяется server-side и ограничен workspace/account;
- read token не может вызвать commit;
- preview ограничен по ресурсу, операции, времени и service token;
- confirmation одноразовый;
- `preview_only` остаётся authoritative policy;
- ошибки MCP не раскрывают provider SDK, токены или stack trace.

## Data migration invariants

- внешние provider IDs остаются строками;
- connections, accounts и reports получают workspace scope;
- credentials мигрируются только внутри controlled runtime и остаются
  encrypted at rest;
- selected accounts и account restrictions сохраняются;
- browser sessions можно ротировать при cutover, но users/workspaces не
  создаются заново без необходимости;
- старые callback routes остаются доступными во время blue/green.

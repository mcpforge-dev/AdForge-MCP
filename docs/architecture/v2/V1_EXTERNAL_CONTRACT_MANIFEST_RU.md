# V1 external contract manifest

Документ фиксирует контракт, который V2 обязана сохранить до production cutover.

## Public HTTP contract

### Health and metadata

- `GET /health`
- `GET /ready`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /privacy`
- `GET /terms`

### OAuth callbacks

- `GET /oauth/google/callback`
- `GET /oauth/meta/callback`
- `GET /oauth/yandex/callback`
- `GET /oauth/tiktok/callback`
- `GET /oauth/google-search-console/callback`
- `GET /auth/google/callback`

Callback URLs являются частью настроек внешних платформ. V2 не заменяет их на
`/api/v1/...` и не принимает redirect URL от браузера без server-side allowlist.

### MCP transport

- `POST /mcp`
- bearer/service-token authentication;
- unauthenticated `/mcp` must remain `401`;
- `preview_only` and server-side read/write policy remain authoritative.

### Dashboard compatibility routes

V1 dashboard routes are preserved during migration and mapped to V2 modules or a
temporary compatibility adapter. The migration manifest covers at minimum:

- `/api/auth/*`;
- `/api/profile*`;
- `/api/mcp-token*`;
- `/api/mcp-oauth-client*`;
- `/api/hosted/*`;
- `/api/connection-requests*`;
- `/api/admin/*`;
- `/api/diagnostics*`;
- `/api/seo/*`;
- `/api/site/*`;
- `/api/meta/*`;
- report DOCX/PDF download routes.

## MCP capability groups

V1 tool groups that must be registered in V2 compatibility tests:

- discovery and account reads;
- campaign/object reads;
- analytics and detailed reports;
- Google/Meta billing and diagnostics;
- Meta Business/Page/Instagram reads;
- site analysis;
- SEO/Search Console;
- monthly ads reports and document exports;
- preview/write intent tools;
- confirmation/commit policy tools;
- skill presets and report collection.

The exact tool-name inventory is generated from the V1 builders during parity
work. A tool is not considered migrated merely because a similarly named V2
service exists; its input, authorization and response semantics must be tested.

## Migration invariants

- external provider IDs remain strings and are never regenerated;
- workspace scope is checked server-side for every resource;
- credentials are encrypted at rest and absent from responses/logs;
- selected accounts remain selected after import;
- read tokens cannot call write tools;
- preview confirmation is one-time, expiring and resource-bound;
- old callback URLs continue to resolve during blue/green operation.

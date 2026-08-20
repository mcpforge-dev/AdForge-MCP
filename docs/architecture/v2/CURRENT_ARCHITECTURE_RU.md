# Current Architecture Report

## Краткий вывод

Текущая система — работающий Python modular-ish MVP, но не production SaaS-платформа в архитектурном смысле. Основная ценность уже есть: provider integrations, OAuth scenarios, workspace-aware auth, MCP tools, reports и safety policy. Основные ограничения — синхронный web runtime, plaintext JSON credentials, inline schema creation, отсутствие очередей и полного CI/security pipeline.

## Runtime topology

```text
Browser / MCP client
        |
      nginx + TLS
       |          |
  web service   MCP HTTP service
  127.0.0.1:8765  127.0.0.1:8766
       |          |
  BaseHTTPRequestHandler / FastMCP + Starlette
       |          |
  AuthStore     provider adapters
       |          |
 PostgreSQL     connections.json / uploads / reports
```

Live `/opt/adforge-mcp` и staging `/opt/adforge-mcp-staging` используют отдельные env, systemd units, localhost ports, storage и PostgreSQL databases. Nginx проксирует live на `8765/8766`, staging на `18765/18766`.

## Application layers

- `src/ad_mcp/web/server.py`: hand-routed HTTP API, sessions, auth endpoints, uploads, report endpoints, static UI.
- `src/ad_mcp/web/auth_store.py`: users/workspaces/memberships/sessions/OAuth state/service tokens и PostgreSQL/SQLite persistence.
- `src/ad_mcp/server.py`: FastMCP registration, provider map, tool guard and write registration.
- `src/ad_mcp/http_server.py`: MCP HTTP transport.
- `src/ad_mcp/runtime_context.py`, `mcp_auth.py`: request context, bearer verification, service-token scope/account guard.
- `src/ad_mcp/providers/*`: Google Ads, Meta Ads, TikTok Ads, Yandex Direct.
- `src/ad_mcp/core/connection_store.py`: workspace-scoped JSON provider credentials/configuration.
- `src/ad_mcp/tools/*`: reports, discovery, provider reads, Meta Graph, site analysis, previews and writes.
- `src/ad_mcp/reporting/*`, `web/monthly_ads_report.py`: report data and document/PDF exports.
- `src/ad_mcp/web/static/*`: client-side dashboard without React/Next.js.

## Configuration and deploy

Settings are Pydantic Settings with `AD_MCP_` prefix (`src/ad_mcp/settings.py`). Systemd uses separate `EnvironmentFile`, `User=adforge`, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem` and narrow `ReadWritePaths` as documented in `docs/deploy/*`.

`.env`, tokens, logs, outputs and connection files are ignored by Git. Live connection JSON is owner-only (`adforge:adforge`, mode 600); production env is root-only. This is useful containment, but not encryption at rest.

## Production facts

At audit time live and staging services were active. Public passive checks returned the expected health/readiness responses and `401` for unauthenticated MCP. Responses include CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, CORP and Permissions-Policy. Nginx has per-route rate-limit zones, but application rate limiting is in-process.

## Architectural boundary

Provider adapters are not exposed directly to the browser: web and MCP tools call them through Python application code. However, the current process still combines transport, auth, domain routing and provider orchestration. This is the boundary to preserve conceptually in v2, then make explicit as modules and contracts.


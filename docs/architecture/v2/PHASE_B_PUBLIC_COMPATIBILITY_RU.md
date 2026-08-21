# Phase B: public compatibility contract

V2 сохраняет внешний production contract V1. После будущего cutover hostname, DNS, TLS, OAuth applications и callback URLs не меняются.

## OAuth callbacks

| Provider              | V1 callback                             | V2 callback                             | Status                     |
| --------------------- | --------------------------------------- | --------------------------------------- | -------------------------- |
| Google Ads            | `/oauth/google/callback`                | `/oauth/google/callback`                | SAME                       |
| Meta Ads              | `/oauth/meta/callback`                  | `/oauth/meta/callback`                  | SAME                       |
| Google Search Console | `/oauth/google-search-console/callback` | `/oauth/google-search-console/callback` | SAME                       |
| Yandex Direct         | `/oauth/yandex/callback`                | `/oauth/yandex/callback`                | SAME                       |
| TikTok Ads            | `/oauth/tiktok/callback`                | `/oauth/tiktok/callback`                | SAME                       |
| Google Login          | `/auth/google/callback`                 | compatibility route                     | MUST_VERIFY_BEFORE_CUTOVER |

## MCP and OAuth metadata

- `/mcp` remains the public MCP transport path and is bearer-protected.
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` remain available through compatibility controllers.
- `/oauth/authorize`, `/oauth/token`, `/oauth/register` remain compatibility paths for existing MCP clients.
- `/api/mcp-token*` and `/api/mcp-oauth-client*` remain compatibility paths; V2 enforces workspace, account, scope, expiry and revocation server-side.

## Browser/API compatibility

The V1 route inventory is in `src/ad_mcp/web/server.py`. V2 has explicit compatibility controllers for auth, hosted OAuth, diagnostics, reports, site analysis, profile, admin, manual Meta onboarding and legacy Meta skills. The final gate is an HTTP route smoke against a V2 runtime with a migrated rehearsal DB; route names alone are insufficient.

## No external contract changes

Do not add a V2 public hostname, DNS record or provider callback. If a V2 internal route differs, keep the V1 route and route it into the V2 module. Any exception requires explicit approval because it would force provider reconfiguration.

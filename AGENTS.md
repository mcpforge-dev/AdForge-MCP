# HolyMedia MCP Agent Instructions

These instructions are for OpenHands, Codex, Claude Code, Gemini, and any other coding agent working in this repository.

## Product Context

HolyMedia MCP is a hosted MCP service for ad account operations through AI clients. The customer flow is hosted: users connect ad platforms in the web dashboard, create a personal MCP token, and connect the remote MCP endpoint to Codex, Claude, ChatGPT, or another MCP-compatible client.

The live service is `https://mcp.holymedia.kz`.

## Safety Rules

- Do not commit or print secrets: `.env`, OAuth credentials, beta tokens, database URLs, SMTP passwords, raw MCP tokens, access tokens, refresh tokens, logs, backups, or uploaded user files.
- Do not edit `connections.json` unless the task explicitly asks for a planned migration or backup.
- Keep `AD_MCP_PREVIEW_ONLY=true` behavior intact. Do not enable real ad write actions.
- Do not open `/mcp` publicly. It must require authentication.
- Do not create fake ad accounts, campaigns, metrics, or provider data.
- Keep workspace/user isolation intact. A normal user must never see another user's ad accounts.
- If provider credentials or permissions are missing, show a clear product-level status and keep technical details in diagnostics/admin areas only.

## Repository Hotspots

- Web UI: `src/ad_mcp/web/static/app.js`, `src/ad_mcp/web/static/app.css`, `src/ad_mcp/web/templates/index.html`
- Web API/service layer: `src/ad_mcp/web/server.py`, `src/ad_mcp/web/service.py`
- MCP transport/tools: `src/ad_mcp/http_server.py`, `src/ad_mcp/server.py`, `src/ad_mcp/tools/`
- OAuth/connections: `src/ad_mcp/core/connection_store.py`, provider modules under `src/ad_mcp/providers/`
- Auth/profile/admin: `src/ad_mcp/web/auth_store.py`
- Site audit: search for `site_audit` and `site-analysis` before editing the AI-analysis module.

## Required Checks Before Finishing

Run the relevant focused checks, and for broad changes run all of these:

```bash
pytest -q
python -m compileall src scripts
node --check src/ad_mcp/web/static/app.js
git diff --check
```

For live/deploy tasks, verify:

```bash
curl -i https://mcp.holymedia.kz/health
curl -i https://mcp.holymedia.kz/ready
curl -i https://mcp.holymedia.kz/mcp
```

Expected: `/health` is `200`, `/ready` is `200`, `/mcp` without a token is `401`.

## Development Style

- Prefer small, safe, reviewable changes over broad rewrites.
- Preserve Russian client-facing UI text unless the task explicitly asks otherwise.
- Keep the dashboard practical and calm: clear statuses, readable cards, understandable errors.
- For frontend changes, test desktop and mobile layout assumptions.
- Add or update regression tests when changing backend behavior.
- Explain blockers honestly instead of masking provider/API permission problems.

## Deployment Guardrails

- Do not deploy from an agent unless the user explicitly asks for deploy.
- Do not paste SSH passwords or tokens into commands or logs.
- If `git pull --ff-only` fails because the VPS has local changes, stop and report it.
- Restart only the known services when deploying: `adforge-mcp-web` and `adforge-mcp-http`.


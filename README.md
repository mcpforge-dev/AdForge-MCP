# HolyMedia MCP

HolyMedia MCP - hosted MCP-сервис для безопасной работы с рекламными кабинетами через Codex, Claude и другие MCP-compatible клиенты.

Главная beta-модель: клиент не скачивает GitHub-репозиторий и не запускает MCP-сервер локально. HolyMedia MCP разворачивается на нашем VPS/WPS-сервере, рекламные кабинеты подключаются через web dashboard и OAuth, а AI-клиент подключается к уже работающему hosted MCP endpoint.

## Beta Customer Setup

Для beta-пользователя рабочий сценарий такой:

1. Получить URL dashboard и создать email-аккаунт.
2. Открыть dashboard HolyMedia MCP и войти в личный кабинет.
3. На `Overview` увидеть статус сервиса, preview-only бейдж и блок `Connect to MCP client`.
4. Перейти в `Connections` и подключить Meta Ads и/или Google Ads через OAuth.
5. Выбрать рекламные аккаунты после OAuth callback и сохранить выбор.
6. На `Diagnostics` запустить полную диагностику.
7. На вкладке `MCP` создать персональный MCP token и сразу сохранить raw token.
8. Скопировать MCP URL из блока `Connect to MCP client`.
9. Добавить HolyMedia MCP в Codex, Claude или другой MCP-клиент как внешний hosted server/custom connector (Bearer-авторизация персональным MCP token).
10. Задать AI-клиенту тестовый запрос: `Проверь диагностику HolyMedia MCP`.

Клиенту не нужны `.env`, `ads_config.yaml`, GitHub clone или локальный Python runtime.

Dashboard состоит из трёх разделов: `Overview` (статус, next steps, MCP URL), `Connections` (карточки платформ, OAuth, выбор аккаунтов) и `Diagnostics` (service/security/MCP/platforms). Опасные действия только в preview-only mode.

## Beta-Ready MVP Scope

В beta фиксируем такой честный scope:

- Hosted MCP transport: Streamable HTTP endpoint, по умолчанию `/mcp`.
- Web dashboard: token gate, Overview, Connections (OAuth onboarding, account selection, reconnect/disconnect) и Diagnostics.
- Auth: Web UI работает через email-сессии; MCP endpoint принимает персональный MCP token пользователя и сохраняет `AD_MCP_WEB_API_TOKEN` как fallback для smoke/operator сценариев.
- Meta Ads: OAuth, выбор аккаунтов, campaigns, statuses, basic metrics, diagnostics.
- Google Ads: OAuth, выбор customer accounts, campaigns, statuses, basic metrics, diagnostics при валидных Google Ads credentials и developer token.
- TikTok Ads: OAuth groundwork и сохранение подключения; campaigns/metrics в beta могут возвращать `not_available`.
- Yandex Direct: OAuth groundwork и сохранение подключения; campaigns/metrics в beta могут возвращать `not_available`.
- Safety: реальные write-действия отключены, опасные действия работают только через preview-only tools.
- Storage: `tokens/connections.json` используется как beta storage и не коммитится.

Вне beta scope:

- реальные изменения бюджетов, статусов и названий кампаний;
- публичный multi-tenant SaaS без отдельной изоляции пользователей;
- production database-backed encrypted token storage;
- ClickHouse persistence как основной слой хранения;
- fake metrics вместо реальных provider data.

## MCP Tools

Основные beta tools:

- Diagnostics: `run_diagnostics`, `run_connection_diagnostics`, `list_connected_platforms`, `get_account_status`.
- Accounts: `list_ad_accounts`.
- Campaigns: `list_campaigns`, `get_campaign`, `get_campaign_statuses`.
- Metrics: `get_basic_metrics`.
- Preview-only actions: `preview_pause_campaign`, `preview_resume_campaign`, `preview_change_campaign_budget`, `preview_change_campaign_name`, `preview_pause_adset_or_group`, `preview_resume_adset_or_group`, `preview_change_adset_or_group_budget`, `preview_pause_ad`, `preview_resume_ad`.

Полная справка: [docs/beta/MCP_TOOLS_REFERENCE_RU.md](docs/beta/MCP_TOOLS_REFERENCE_RU.md).

## Beta Docs

- [docs/beta/LIVE_BETA_STATUS_RU.md](docs/beta/LIVE_BETA_STATUS_RU.md) - текущий live-статус hosted beta и blockers этапа live OAuth.
- [docs/beta/END_TO_END_BETA_VALIDATION_RU.md](docs/beta/END_TO_END_BETA_VALIDATION_RU.md) - end-to-end validation hosted beta.
- [docs/beta/BETA_ACCEPTANCE_CHECKLIST_RU.md](docs/beta/BETA_ACCEPTANCE_CHECKLIST_RU.md) - acceptance checklist before beta launch.
- [docs/beta/BETA_DEMO_SCRIPT_RU.md](docs/beta/BETA_DEMO_SCRIPT_RU.md) - demo script for a short beta walkthrough.
- [docs/beta/BETA_CAPABILITIES_RU.md](docs/beta/BETA_CAPABILITIES_RU.md) - safe `/api/beta/capabilities` reference.
- [docs/beta/GO_NO_GO_RU.md](docs/beta/GO_NO_GO_RU.md) - go/no-go criteria for hosted beta.
- [docs/beta/LIVE_VPS_RUNBOOK_RU.md](docs/beta/LIVE_VPS_RUNBOOK_RU.md) - live VPS/WPS deployment runbook.
- [docs/beta/LIVE_VPS_COMMANDS_RU.md](docs/beta/LIVE_VPS_COMMANDS_RU.md) - copy-paste live deployment commands.
- [docs/beta/VPS_RECOVERY_RU.md](docs/beta/VPS_RECOVERY_RU.md) - recovery checklist when the live VPS/WPS is unavailable.
- [docs/beta/OAUTH_CREDENTIALS_SETUP_RU.md](docs/beta/OAUTH_CREDENTIALS_SETUP_RU.md) - hosted OAuth credentials setup for Meta/Google/TikTok/Yandex.
- [docs/beta/LEGACY_CREDENTIALS_CLEANUP_RU.md](docs/beta/LEGACY_CREDENTIALS_CLEANUP_RU.md) - cleanup plan for old tokens and compromised legacy credentials.
- [docs/beta/USER_AUTH_ADMIN_ROADMAP_RU.md](docs/beta/USER_AUTH_ADMIN_ROADMAP_RU.md) - roadmap for Russian UI, user auth, admin panel, roles and database.
- [docs/beta/BETA_READY_MVP_RU.md](docs/beta/BETA_READY_MVP_RU.md) - главный scope beta-ready MVP.
- [docs/beta/DASHBOARD_CONNECTIONS_RU.md](docs/beta/DASHBOARD_CONNECTIONS_RU.md) - подключение рекламных платформ через dashboard/OAuth.
- [docs/beta/CODEX_MCP_SETUP_RU.md](docs/beta/CODEX_MCP_SETUP_RU.md) - подключение hosted MCP в Codex.
- [docs/beta/CLAUDE_CONNECTOR_SETUP_RU.md](docs/beta/CLAUDE_CONNECTOR_SETUP_RU.md) - подключение hosted MCP в Claude.
- [docs/beta/OTHER_MCP_CLIENTS_RU.md](docs/beta/OTHER_MCP_CLIENTS_RU.md) - Gemini и другие MCP-compatible клиенты.
- [docs/beta/MCP_TOOLS_REFERENCE_RU.md](docs/beta/MCP_TOOLS_REFERENCE_RU.md) - beta tools reference.
- [docs/beta/BETA_SECURITY_RU.md](docs/beta/BETA_SECURITY_RU.md) - безопасность, preview-only и секреты.
- [docs/beta/SECURITY_HARDENING_RU.md](docs/beta/SECURITY_HARDENING_RU.md) - hosted beta security hardening и access control.
- [docs/beta/BETA_DEMO_CHECKLIST_RU.md](docs/beta/BETA_DEMO_CHECKLIST_RU.md) - чеклист beta-demo.
- [docs/beta/VPS_DEPLOYMENT_RU.md](docs/beta/VPS_DEPLOYMENT_RU.md) - production-like beta deployment на VPS/WPS.
- [docs/beta/ENVIRONMENT_RU.md](docs/beta/ENVIRONMENT_RU.md) - env variables для hosted beta.
- [docs/beta/REVERSE_PROXY_RU.md](docs/beta/REVERSE_PROXY_RU.md) - Nginx/Caddy, HTTPS и proxy routing.
- [docs/beta/SYSTEMD_SERVICE_RU.md](docs/beta/SYSTEMD_SERVICE_RU.md) - systemd unit setup.
- [docs/beta/STORAGE_AND_BACKUP_RU.md](docs/beta/STORAGE_AND_BACKUP_RU.md) - storage, backup и restore.
- [deploy/adforge-mcp.env.example](deploy/adforge-mcp.env.example) - VPS env template without real secrets.
- [scripts/deploy_live_dashboard.sh](scripts/deploy_live_dashboard.sh) - safe one-command dashboard update script for the recovered VPS.
- [docs/beta/HOSTED_MCP_TRANSPORT_RU.md](docs/beta/HOSTED_MCP_TRANSPORT_RU.md) - hosted MCP transport.
- [docs/beta/DIAGNOSTICS_RU.md](docs/beta/DIAGNOSTICS_RU.md) - backend/dashboard/MCP diagnostics.
- [docs/beta/PARTNER_OAUTH_FLOWS_RU.md](docs/beta/PARTNER_OAUTH_FLOWS_RU.md) - OAuth flows Google/TikTok/Yandex.
- [docs/beta/META_OAUTH_FLOW_RU.md](docs/beta/META_OAUTH_FLOW_RU.md) - Meta OAuth flow.
- [docs/beta/mcp.example.json](docs/beta/mcp.example.json) - пример MCP client config без реальных секретов.

## Developer Setup

Этот раздел нужен только разработчикам и серверной команде HolyMedia MCP.

### Windows

```powershell
cd "C:\MCP\adforge-mcp"
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev,google,meta]"
```

### Linux / VPS

```bash
cd /opt/adforge-mcp
python3.11 -m venv .venv
./.venv/bin/python -m pip install -e ".[dev,google,meta]"
```

Локальные runtime-файлы создаются только на машине разработчика или на сервере:

- `.env` на основе [.env.example](.env.example);
- `ads_config.yaml` на основе [ads_config.example.yaml](ads_config.example.yaml), если нужен fallback/local provider config;
- `tokens/connections.json` создается runtime-логикой OAuth и должен оставаться ignored.

Нельзя коммитить реальные `access_token`, `refresh_token`, `client_secret`, `app_secret`, `developer_token`, `.env`, `ads_config.yaml` или `tokens/connections.json`.

## Local Developer Commands

Web dashboard:

```powershell
.\.venv\Scripts\python.exe -m ad_mcp.web.server
```

Hosted MCP transport:

```powershell
.\.venv\Scripts\ad-mcp-http.exe
```

Smoke and tests:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m compileall src
node --check src/ad_mcp/web/static/app.js
.\.venv\Scripts\python.exe scripts/smoke_mcp_beta.py
```

## Production Notes

Recommended beta deployment uses two internal processes behind Nginx:

- dashboard/API: `127.0.0.1:8765`;
- MCP transport: `127.0.0.1:8766/mcp`.

External users receive dashboard URL, MCP URL and create their personal MCP token inside `/app`. Server secrets and the beta fallback token stay in environment variables on the VPS/WPS server.

Deployment details for the server team: [DEPLOYING.md](DEPLOYING.md).

Production-like beta deployment guide: [docs/beta/VPS_DEPLOYMENT_RU.md](docs/beta/VPS_DEPLOYMENT_RU.md).

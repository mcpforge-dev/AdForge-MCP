# AdForge MCP hosted beta onboarding

Этот документ оставлен как короткая точка входа. Полный beta-scope описан в [BETA_READY_MVP_RU.md](BETA_READY_MVP_RU.md).

## Главный принцип

AdForge MCP - hosted MCP-сервис. Клиент не скачивает GitHub-репозиторий, не запускает сервер локально и не редактирует `.env`/`ads_config.yaml`.

Клиент делает две вещи:

1. Подключает рекламные кабинеты через AdForge dashboard и OAuth.
2. Подключает уже работающий hosted MCP endpoint в Codex, Claude, Gemini или другой MCP-клиент.

## Быстрый путь beta-пользователя

1. Получить dashboard URL, hosted MCP URL и beta token.
2. Открыть dashboard.
3. Перейти в `Connections`.
4. Подключить Meta Ads и/или Google Ads через OAuth.
5. Выбрать доступные рекламные аккаунты.
6. Запустить диагностику.
7. Скопировать MCP URL.
8. Добавить AdForge MCP в AI-клиент.
9. Проверить tools запросом: `Проверь диагностику AdForge MCP`.

## Подробные инструкции

- End-to-end validation: [END_TO_END_BETA_VALIDATION_RU.md](END_TO_END_BETA_VALIDATION_RU.md).
- Acceptance checklist: [BETA_ACCEPTANCE_CHECKLIST_RU.md](BETA_ACCEPTANCE_CHECKLIST_RU.md).
- Demo script: [BETA_DEMO_SCRIPT_RU.md](BETA_DEMO_SCRIPT_RU.md).
- Beta capabilities endpoint: [BETA_CAPABILITIES_RU.md](BETA_CAPABILITIES_RU.md).
- Go/no-go: [GO_NO_GO_RU.md](GO_NO_GO_RU.md).
- Live VPS recovery: [VPS_RECOVERY_RU.md](VPS_RECOVERY_RU.md).
- OAuth credentials setup: [OAUTH_CREDENTIALS_SETUP_RU.md](OAUTH_CREDENTIALS_SETUP_RU.md).
- Legacy credentials cleanup: [LEGACY_CREDENTIALS_CLEANUP_RU.md](LEGACY_CREDENTIALS_CLEANUP_RU.md).
- User auth/admin roadmap: [USER_AUTH_ADMIN_ROADMAP_RU.md](USER_AUTH_ADMIN_ROADMAP_RU.md).
- Dashboard/OAuth: [DASHBOARD_CONNECTIONS_RU.md](DASHBOARD_CONNECTIONS_RU.md).
- Codex: [CODEX_MCP_SETUP_RU.md](CODEX_MCP_SETUP_RU.md).
- Claude: [CLAUDE_CONNECTOR_SETUP_RU.md](CLAUDE_CONNECTOR_SETUP_RU.md).
- Gemini/other clients: [OTHER_MCP_CLIENTS_RU.md](OTHER_MCP_CLIENTS_RU.md).
- Tools: [MCP_TOOLS_REFERENCE_RU.md](MCP_TOOLS_REFERENCE_RU.md).
- Security: [BETA_SECURITY_RU.md](BETA_SECURITY_RU.md).
- Security hardening: [SECURITY_HARDENING_RU.md](SECURITY_HARDENING_RU.md).
- Demo checklist: [BETA_DEMO_CHECKLIST_RU.md](BETA_DEMO_CHECKLIST_RU.md).
- VPS deployment: [VPS_DEPLOYMENT_RU.md](VPS_DEPLOYMENT_RU.md).
- Environment: [ENVIRONMENT_RU.md](ENVIRONMENT_RU.md).
- Reverse proxy / HTTPS: [REVERSE_PROXY_RU.md](REVERSE_PROXY_RU.md).
- Systemd: [SYSTEMD_SERVICE_RU.md](SYSTEMD_SERVICE_RU.md).
- Storage and backup: [STORAGE_AND_BACKUP_RU.md](STORAGE_AND_BACKUP_RU.md).

## Beta platform status

- Meta Ads: OAuth, account selection, campaigns, metrics, diagnostics.
- Google Ads: OAuth, account selection, campaigns, metrics, diagnostics.
- TikTok Ads: OAuth groundwork; campaigns/metrics могут быть `not_available`.
- Yandex Direct: OAuth groundwork; campaigns/metrics могут быть `not_available`.

## Safety

Beta работает в preview-only mode. Если пользователь просит изменить бюджет, остановить кампанию или выполнить другое dangerous-действие, MCP возвращает preview с `will_apply=false`.

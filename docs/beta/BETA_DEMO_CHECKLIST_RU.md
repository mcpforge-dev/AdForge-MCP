# Beta demo checklist

Этот чеклист нужен перед демонстрацией beta-ready MVP.

Связанные документы этапа 9:

- [END_TO_END_BETA_VALIDATION_RU.md](END_TO_END_BETA_VALIDATION_RU.md) - полная проверка от VPS до MCP-клиента.
- [BETA_ACCEPTANCE_CHECKLIST_RU.md](BETA_ACCEPTANCE_CHECKLIST_RU.md) - критерии приемки beta.
- [BETA_DEMO_SCRIPT_RU.md](BETA_DEMO_SCRIPT_RU.md) - короткий сценарий демонстрации.
- [GO_NO_GO_RU.md](GO_NO_GO_RU.md) - решение GO / CONDITIONAL GO / NO-GO.
- [LIVE_VPS_RUNBOOK_RU.md](LIVE_VPS_RUNBOOK_RU.md) - live VPS deployment runbook.
- [LIVE_VPS_COMMANDS_RU.md](LIVE_VPS_COMMANDS_RU.md) - copy-paste команды для оператора.
- [../../deploy/adforge-mcp.env.example](../../deploy/adforge-mcp.env.example) - env template для VPS.

## A. Server / deployment

- VPS deployment guide reviewed: [VPS_DEPLOYMENT_RU.md](VPS_DEPLOYMENT_RU.md).
- Env variables reviewed: [ENVIRONMENT_RU.md](ENVIRONMENT_RU.md).
- Reverse proxy / HTTPS reviewed: [REVERSE_PROXY_RU.md](REVERSE_PROXY_RU.md).
- Systemd units installed from [SYSTEMD_SERVICE_RU.md](SYSTEMD_SERVICE_RU.md).
- Storage/backup plan reviewed: [STORAGE_AND_BACKUP_RU.md](STORAGE_AND_BACKUP_RU.md).
- Backend web process запущен.
- Hosted MCP process запущен.
- Dashboard открывается по публичному URL.
- MCP endpoint доступен по публичному URL, обычно `/mcp`.
- `AD_MCP_WEB_API_TOKEN` настроен.
- `GET /health` работает.
- `GET /ready` возвращает `ready`.
- Запрос без beta token получает 401.
- Запрос с beta token проходит.
- `GET /api/diagnostics` работает.
- `GET /api/diagnostics/mcp` показывает hosted MCP URL и auth status.
- `GET /api/diagnostics/security` показывает posture без секретов.

## B. OAuth / dashboard

- Meta env variables заполнены.
- Google env variables заполнены.
- Redirect URLs у провайдеров совпадают с server callback URLs.
- Meta OAuth проходит.
- Google OAuth проходит.
- После callback отображается pending account selection.
- Аккаунты отображаются.
- Выбранные аккаунты сохраняются.
- Connections показывает connected/MCP ready.
- `Run diagnostics` работает.
- `Reconnect` запускает OAuth заново.
- `Disconnect` удаляет подключение.

## C. MCP client

- Codex видит HolyMedia MCP server.
- Claude видит HolyMedia custom connector.
- Tools отображаются в MCP client.
- `run_diagnostics` работает.
- `list_connected_platforms` работает.
- `list_ad_accounts` работает.
- `list_campaigns` работает для Meta/Google при валидных credentials.
- `get_basic_metrics` работает для Meta/Google при валидных credentials.
- TikTok/Yandex честно возвращают limited/`not_available`, если read tools еще не готовы.

## D. Safety

- `AD_MCP_PREVIEW_ONLY=true`.
- `preview_change_campaign_budget` возвращает `will_apply=false`.
- `preview_pause_campaign` возвращает `mode=preview_only`.
- `commit_preview` заблокирован.
- Реальные write endpoints провайдеров не вызываются.
- Токены не попадают в dashboard response.
- Токены не попадают в diagnostics response.
- `tokens/connections.json` не закоммичен.
- `.env` и `ads_config.yaml` не закоммичены.
- OAuth callback с invalid/reused state отклоняется.
- Nginx rate limiting включен или явно отложен.
- CSP/security headers включены.

## E. Known limitations

- TikTok Ads campaigns/metrics могут быть limited или `not_available`.
- Yandex Direct campaigns/metrics могут быть limited или `not_available`.
- Production user isolation еще не финализирован.
- JSON storage используется только для beta.
- Live provider credentials проверяются вручную.

## Demo flow

1. Открыть dashboard.
2. Ввести beta token, если dashboard запросил доступ.
3. Перейти в `Connections`.
4. Показать hosted MCP block и кнопку `Copy MCP URL`.
5. Подключить Meta Ads или показать уже подключенный аккаунт.
6. Подключить Google Ads или показать уже подключенный customer account.
7. Запустить `Run diagnostics` на платформе.
8. Открыть Codex или Claude.
9. Добавить hosted MCP URL и beta token.
10. Спросить: `Проверь диагностику HolyMedia MCP`.
11. Спросить: `Покажи подключенные рекламные аккаунты`.
12. Спросить: `Покажи кампании Meta Ads`.
13. Спросить: `Покажи базовые метрики за последние 7 дней`.
14. Спросить: `Сделай preview изменения бюджета кампании, но ничего не применяй`.
15. Показать в ответе `will_apply=false`.

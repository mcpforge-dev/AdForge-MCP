# Beta acceptance checklist HolyMedia MCP

Чеклист фиксирует минимальные критерии, при которых hosted beta можно считать готовой к ограниченному запуску.

## Hosted model

- [ ] Клиентский путь не требует GitHub clone.
- [ ] Клиентский путь не требует локального запуска MCP server.
- [ ] Клиентский путь не требует `.env` или `ads_config.yaml`.
- [ ] Dashboard URL выдан beta-пользователю.
- [ ] Hosted MCP URL выдан beta-пользователю или доступен через dashboard.
- [ ] Beta token выдан безопасным каналом.

## Deployment

- [ ] Web process запущен.
- [ ] Hosted MCP HTTP process запущен.
- [ ] Reverse proxy настроен.
- [ ] HTTPS включен.
- [ ] `/health` возвращает `ok`.
- [ ] `/ready` возвращает `ready`.
- [ ] `/ready` не раскрывает секреты.
- [ ] `scripts/smoke_hosted_beta.py --strict-deploy` проходит без `--live`.

## Access control

- [ ] `/api/diagnostics` без token отклоняется.
- [ ] `/api/diagnostics` с неверным token отклоняется.
- [ ] `/api/diagnostics` с верным token проходит.
- [ ] `/api/beta/capabilities` закрыт beta token.
- [ ] `/mcp` без token отклоняется.
- [ ] `/api/diagnostics/security` показывает `api_auth_required=true`.

## Security posture

- [ ] `AD_MCP_WEB_API_TOKEN` задан.
- [ ] `AD_MCP_PREVIEW_ONLY=true`.
- [ ] `live_writes_enabled=false`.
- [ ] `tokens_returned=false`.
- [ ] `secrets_redacted=true`.
- [ ] `.env` не в Git.
- [ ] `tokens/connections.json` не в Git.
- [ ] `ads_config.yaml` не в Git.
- [ ] Logs не содержат access token, refresh token, client secret, app secret, developer token.

## Dashboard onboarding

- [ ] Connections screen открывается.
- [ ] Meta Ads card отображается.
- [ ] Google Ads card отображается.
- [ ] TikTok Ads card отображается как limited/next, если live reads не готовы.
- [ ] Yandex Direct card отображается как limited/next, если live reads не готовы.
- [ ] OAuth start работает для настроенных providers.
- [ ] Pending account selection отображается после callback.
- [ ] Selected accounts сохраняются.
- [ ] Reconnect работает.
- [ ] Disconnect работает.
- [ ] Run diagnostics показывает понятный результат.

## OAuth

- [ ] Meta redirect URL прописан у Meta.
- [ ] Google redirect URL прописан у Google.
- [ ] TikTok redirect URL прописан у TikTok, если проверяется live.
- [ ] Yandex redirect URL прописан у Yandex, если проверяется live.
- [ ] OAuth state одноразовый.
- [ ] Invalid/reused state отклоняется.
- [ ] Tokens сохраняются только server-side.
- [ ] Dashboard не показывает raw tokens.

## MCP tools

- [ ] `run_diagnostics` работает.
- [ ] `list_connected_platforms` работает.
- [ ] `list_ad_accounts` работает.
- [ ] `get_account_status` работает.
- [ ] `run_connection_diagnostics` работает.
- [ ] `list_campaigns` работает для Meta/Google при валидных credentials.
- [ ] `get_campaign` работает для Meta/Google при валидных credentials.
- [ ] `get_campaign_statuses` работает для Meta/Google при валидных credentials.
- [ ] `get_basic_metrics` работает для Meta/Google при валидных credentials.
- [ ] TikTok/Yandex честно возвращают `not_available` там, где live provider read еще не готов.
- [ ] Fake metrics не возвращаются как реальные.

## Preview-only

- [ ] `preview_pause_campaign` возвращает `will_apply=false`.
- [ ] `preview_resume_campaign` возвращает `will_apply=false`.
- [ ] `preview_change_campaign_budget` возвращает `will_apply=false`.
- [ ] `preview_change_campaign_name` возвращает `will_apply=false`.
- [ ] `commit_preview` заблокирован.
- [ ] Реальные write endpoints provider не вызываются.

## Documentation

- [ ] Beta onboarding прочитан: [MCP_BETA_ONBOARDING_RU.md](MCP_BETA_ONBOARDING_RU.md).
- [ ] Deployment прочитан: [VPS_DEPLOYMENT_RU.md](VPS_DEPLOYMENT_RU.md).
- [ ] Security hardening прочитан: [SECURITY_HARDENING_RU.md](SECURITY_HARDENING_RU.md).
- [ ] Demo script готов: [BETA_DEMO_SCRIPT_RU.md](BETA_DEMO_SCRIPT_RU.md).
- [ ] Go/no-go готов: [GO_NO_GO_RU.md](GO_NO_GO_RU.md).

## Acceptance result

Beta может идти в ограниченный запуск, если все blocking пункты в sections Hosted model, Deployment, Access control, Security posture и Preview-only закрыты.

Если provider credentials недоступны, это не блокирует technical beta только при условии, что в demo явно показан статус `not_available`/`blocked by credentials`, а не fake success.

# Go/no-go для hosted beta HolyMedia MCP

Этот документ помогает принять решение: можно ли выпускать текущую hosted beta ограниченному пользователю или нужно остановиться.

## Go

Решение `GO` можно принять, если выполнены все условия:

- hosted deployment запущен на VPS/WPS;
- live deploy выполнен по [LIVE_VPS_RUNBOOK_RU.md](LIVE_VPS_RUNBOOK_RU.md);
- env file создан на основе [../../deploy/adforge-mcp.env.example](../../deploy/adforge-mcp.env.example);
- dashboard открывается по HTTPS;
- hosted MCP endpoint доступен по HTTPS;
- `/health` и `/ready` работают;
- Web API и MCP endpoint закрыты beta token;
- `/api/diagnostics/security` показывает `preview_only=true`;
- `/api/diagnostics/security` показывает `live_writes_enabled=false`;
- `/api/diagnostics/security` показывает `tokens_returned=false`;
- `/api/beta/capabilities` работает только с beta token;
- Meta Ads OAuth проверен или честно отмечен как blocked by credentials;
- Google Ads OAuth проверен или честно отмечен как blocked by credentials;
- connected accounts отображаются без секретов;
- MCP tools видны в Codex/Claude/другом клиенте;
- read tools не возвращают fake metrics;
- preview tools возвращают `will_apply=false`;
- `commit_preview` заблокирован;
- smoke checks и unit tests проходят.
- `scripts/smoke_hosted_beta.py --strict-deploy` проходит на реальном домене.

## No-go

Решение `NO-GO` обязательно, если есть хотя бы один пункт:

- `/api/*` доступен без beta token;
- `/mcp` доступен без beta token;
- `/ready`, diagnostics или capabilities возвращают secrets;
- `AD_MCP_PREVIEW_ONLY=false`;
- есть путь, который вызывает реальный provider write endpoint;
- fake metrics выдаются как реальные;
- OAuth state можно использовать повторно;
- `tokens/connections.json`, `.env` или `ads_config.yaml` попали в Git;
- dashboard показывает raw access/refresh tokens;
- logs содержат client secret, app secret, developer token или bearer token.

## Conditional go

`CONDITIONAL GO` допустим, если техническая платформа готова, но часть live provider checks заблокирована внешними доступами.

Примеры:

- Meta app ожидает review;
- Google Ads developer token не имеет нужного access level;
- TikTok/Yandex OAuth доступен, но campaigns/metrics еще limited;
- у специалиста нет admin access к нужному рекламному кабинету.

Условие: все такие ограничения должны быть явно записаны в demo notes и не маскироваться fake success.

## Known beta limitations

- Это не финальная production multi-tenant auth model.
- Один beta token используется как временный access gate.
- Connection storage основан на `tokens/connections.json`.
- Production encrypted storage и per-user permission model идут следующим этапом.
- TikTok/Yandex campaigns/metrics могут возвращать `not_available`.
- Write/apply actions отключены.

## Решение

Перед запуском заполнить:

- [BETA_ACCEPTANCE_CHECKLIST_RU.md](BETA_ACCEPTANCE_CHECKLIST_RU.md);
- [END_TO_END_BETA_VALIDATION_RU.md](END_TO_END_BETA_VALIDATION_RU.md).
- [LIVE_VPS_COMMANDS_RU.md](LIVE_VPS_COMMANDS_RU.md).

Итог:

```text
Decision: GO / CONDITIONAL GO / NO-GO
Date:
Operator:
Blocking issues:
Manual follow-ups:
```

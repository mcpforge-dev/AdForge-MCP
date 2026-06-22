# Preview-only write actions для beta MVP

В beta-ready MVP HolyMedia MCP не выполняет реальные изменения в рекламных кабинетах. Все потенциально опасные действия возвращают только preview.

## Где включается

Основной флаг:

```env
AD_MCP_PREVIEW_ONLY=true
```

Safety policy:

```yaml
preview_only: true
execution_mode: simulated_no_write
```

При `AD_MCP_PREVIEW_ONLY=true` сервер принудительно выставляет:

- `preview_only=true`;
- `execution_mode=simulated_no_write`;
- `write_mode=preview_only`.

## Preview tools

Кампании:

- `preview_pause_campaign`;
- `preview_resume_campaign`;
- `preview_change_campaign_budget`;
- `preview_change_campaign_name`.

Ad sets / groups:

- `preview_pause_adset_or_group`;
- `preview_resume_adset_or_group`;
- `preview_change_adset_or_group_budget`.

Ads:

- `preview_pause_ad`;
- `preview_resume_ad`.

## Что возвращает preview

Preview всегда содержит:

- `mode: preview_only`;
- `will_apply: false`;
- `platform`;
- `account_id`;
- `object_type`;
- `object_id`;
- `object_name`;
- `action`;
- `current_value`;
- `requested_value`;
- `expected_result`;
- `risk_level`;
- `reason`;
- `note`;
- `preview_token`.

Если текущее состояние объекта нельзя прочитать, preview не создается и tool возвращает структурированную ошибку. Fake-current-state не используется.

## Что заблокировано

- `commit_preview` в beta возвращает `status=blocked`.
- Реальные provider write endpoints не вызываются.
- Preview tools используют только read-current-state и локальную сборку provider payload.

## Ручная проверка

1. Вызвать `get_beta_diagnostics`.
2. Проверить:
   - `security.preview_only=true`;
   - `smoke_checks.live_writes_enabled=false`.
3. Вызвать `preview_pause_campaign` для подключенного аккаунта.
4. Проверить:
   - `mode=preview_only`;
   - `will_apply=false`;
   - есть `current_value` и `requested_value`.
5. Вызвать `commit_preview` с полученным token.
6. Проверить, что ответ `status=blocked`, `provider_response.mode=preview_only`.

## После beta

После отдельного design/security review можно добавить:

- scoped confirmations;
- role-based approval;
- signed preview tokens;
- apply endpoint с audit log;
- provider-specific rollback notes;
- per-account write permissions.

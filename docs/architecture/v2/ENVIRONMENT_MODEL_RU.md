# V2 environment model

| Environment | Config source              | Database            | Redis                | Deploy status          |
| ----------- | -------------------------- | ------------------- | -------------------- | ---------------------- |
| development | .env.v2 ignored by Git     | local v2 PostgreSQL | local v2 Redis       | local only             |
| test        | CI/test process env        | ephemeral/test DB   | ephemeral/test Redis | CI                     |
| staging     | future dedicated v2 env    | dedicated v2 DB     | dedicated v2 Redis   | not created in Phase 1 |
| production  | secret manager/runtime env | dedicated v2 DB     | dedicated v2 Redis   | not created in Phase 1 |

No environment inherits v1 secrets or storage. Production-like config rejects placeholder/local dependency URLs. The configuration package exposes parsed values only; credentials are not logged.

Provider OAuth client variables (`PROVIDER_GOOGLE_*`, `PROVIDER_META_*`) are application secrets and exist only in the runtime secret store. Provider credentials use the separate `PROVIDER_CREDENTIAL_ENCRYPTION_KEYS` key ring and `PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION`; the CI value is test-only and must never be reused in staging or production.

## Controlled provider writes

V2 по умолчанию не выполняет изменения в рекламных кабинетах:

```env
V2_PREVIEW_ONLY=true
V2_CONFIRMED_WRITE_ENABLED=false
V2_WRITE_ACCOUNT_ALLOWLIST=
V2_WRITE_OBJECT_ALLOWLIST=
V2_WRITE_OPERATION_ALLOWLIST=
```

Реальный Meta commit возможен только при одновременном выполнении всех условий:

- service token содержит `adforge:mcp:write` и ограничен нужным workspace/account;
- preview создан сервером, не истёк и подтверждён одноразовым confirmation token;
- `V2_PREVIEW_ONLY=false` и `V2_CONFIRMED_WRITE_ENABLED=true`;
- account, campaign и operation присутствуют в отдельных server-side allowlist;
- OAuth connection фактически получила `ads_management`;
- операция входит в ограниченный набор `change_name`, `pause`, `resume`;
- после commit provider adapter повторно читает campaign и сохраняет audit event.

Allowlist принимает внутренний ProviderAccount ID либо внешний Meta account ID. Object allowlist принимает только campaign ID. Пустой allowlist всегда запрещает commit. Эти параметры нельзя включать глобально для всех аккаунтов и объектов.

Владелец workspace может выдать уже существующему service token scope `adforge:mcp:write` без смены значения ключа. Это разрешено только ключу, который уже ограничен ровно одним рекламным кабинетом; действие пишется в audit log. Изменение scope само по себе не снимает ни один из остальных server-side барьеров выше.

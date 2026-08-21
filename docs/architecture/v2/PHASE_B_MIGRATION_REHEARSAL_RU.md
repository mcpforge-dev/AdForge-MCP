# Phase B: migration rehearsal

Документ описывает безопасный V1 → V2 rehearsal. Он не выполняет production migration и не требует чтения production `.env`, `connections.json` или токенов.

## Контракт sanitized bundle

Экспорт должен содержать только metadata и уже подготовленные V2 encrypted credential envelopes:

- `users`;
- `workspaces`;
- `memberships`;
- `connections` с `accounts`;
- `service_tokens` только с digest, scope и ограничениями;
- `entitlements`.

Поля `access_token`, `refresh_token`, `client_secret`, `app_secret`, `developer_token`, plaintext password, cookie и raw token запрещены. `password_hash` допускается только в самом bundle и никогда не выводится в отчёт.

Для credential migration допустим только envelope `hm1.<nonce>.<tag>.<ciphertext>` с `encryption_version`. Старый V1 Fernet envelope сам по себе не импортируется: его нужно преобразовать внутри закрытого migration runtime, где plaintext существует только в памяти и сразу шифруется V2 AES-256-GCM. Если такой bridge не был выполнен, связь сохраняется как metadata, а статусом фиксируется `reconnect_required`.

## Команды

```powershell
node scripts/v2-provider-migration.mjs inspect scripts/fixtures/v2-migration-bundle.example.json
node scripts/v2-provider-migration.mjs validate scripts/fixtures/v2-migration-bundle.example.json
node scripts/v2-provider-migration.mjs dry-run scripts/fixtures/v2-migration-bundle.example.json
```

`inspect` показывает counts и проблемы формата. `validate` завершается ошибкой при нарушении ссылочной целостности, дублях, неизвестных provider/role или secret-bearing полях. `dry-run` строит повторяемый план действий, но всегда сообщает `mutatesDatabase: false`.

## Production rehearsal порядок

1. Сделать backup V1 DB и runtime storage средствами инфраструктуры, не копируя backup в Git.
2. Сформировать sanitized bundle в защищённом рабочем каталоге.
3. Выполнить `validate`, затем `dry-run`; сохранить только JSON-отчёт без secrets.
4. Создать отдельную V2 rehearsal DB и применить её migrations.
5. Импортировать metadata в транзакции с deterministic source mappings; повторный запуск должен давать `update/skip`, а не дубли.
6. Импортировать credentials только через controlled in-memory bridge или уже готовый V2 envelope.
7. Проверить counts, foreign keys, unique scopes и owner invariants.
8. Выполнить read-only provider smoke и сравнить business-significant values с V1.
9. Для rollback удалить только rehearsal DB либо восстановить её backup. Production source не изменяется.

## Пароли и service tokens

V1 использует `pbkdf2_sha256$...`; V2 принимает этот формат transitional login и после успешного входа меняет hash на Argon2id. Service-token digest V1 и V2 используют SHA-256, поэтому существующее значение можно перенести без plaintext token; workspace/account restrictions проверяются уже V2 server-side.

## Невыполнимые без production access действия

Реальный production export, backup/restore, provider read parity и live Hermes E2E требуют отдельного защищённого запуска на инфраструктуре с уже настроенными env. Этот документ намеренно не предлагает извлекать production secrets на локальный компьютер.

## Fernet bridge

Если V1 export содержит только `credential.encrypted_payload` в формате `v1:...`, перед импортом запускается `scripts/v1-credential-bridge.py`. Скрипт требует `V1_CREDENTIALS_ENCRYPTION_KEY` и `V2_PROVIDER_CREDENTIAL_KEY_B64` только через закрытый runtime, принимает отдельный `--apply`, записывает новый bundle с `hm1` envelope и печатает только количество преобразованных записей. Plaintext-поля и попытка перезаписать input отклоняются.

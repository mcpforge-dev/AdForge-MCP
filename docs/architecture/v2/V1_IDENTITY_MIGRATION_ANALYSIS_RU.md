# V1 identity migration analysis

Документ подготовлен без изменения v1.

## Что нужно проверить перед миграцией

- фактическую таблицу/JSON source users и количество записей;
- формат password hashes и наличие Argon2/bcrypt/PBKDF2 параметров;
- sessions, cookie names, expiration и revocation state;
- workspace ownership и membership records;
- нормализацию email и duplicate candidates;
- существующие reset/verification tokens и их TTL;
- audit/security events, которые должны сохраниться как исторические.

## Предварительная migration matrix

| v1 данные                 | v2 target                                     | Стратегия                                                          |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| user id/email/name        | `users`                                       | dry-run import с нормализацией email и duplicate report            |
| password hash             | `users.password_hash`                         | сохранить только если формат подтверждён; иначе re-login migration |
| workspace owner           | `workspaces` + `workspace_memberships(OWNER)` | создать memberships, не полагаться на `user.workspace_id`          |
| sessions                  | `sessions`                                    | не переносить plaintext; обычно revoke/force re-login              |
| reset/verification tokens | `password_resets` / `email_verifications`     | не переносить plaintext, истёкшие токены отбрасывать               |
| audit history             | `audit_events`                                | импортировать без secrets/tokens/passwords                         |

## Обязательный порядок

1. Backup и read-only inventory.
2. Dry-run с количеством записей, duplicate report и FK checks.
3. Rehearsal на копии PostgreSQL.
4. Password rehash при первом успешном login только если исходный hash безопасно проверяем.
5. Rollback через backup до подтверждения parity.

До отдельной migration phase v1 users, sessions и credentials не читаются новой системой.

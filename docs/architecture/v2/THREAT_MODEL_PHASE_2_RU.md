# Phase 2 threat model

| Угроза               | Контроль                                                         | Проверка                                  |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| Session theft/replay | opaque random cookie, HMAC digest, expiry, revocation, rotation  | forged/expired/revoked session tests      |
| Session fixation     | новый session token после login/password change                  | password-change rotation test             |
| CSRF                 | double-submit cookie + `X-CSRF-Token` + Origin allowlist         | missing/mismatched token test             |
| Tenant breakout      | server-side membership lookup by `(workspace_id,user_id)`        | workspace A/B isolation integration test  |
| Privilege escalation | role-permission table and authorization guard                    | role matrix tests                         |
| Invitation replay    | hashed token, expiry, revoke/accepted state, atomic claim        | invalid/expired/revoked/reused tests      |
| Password reset abuse | Argon2id, generic response, IP/account rate limits, one-time TTL | enumeration and rate-limit tests          |
| Brute force          | Redis counters by privacy-safe IP/account digests                | Redis integration test and CI service     |
| Sensitive logging    | token/password exclusion and domain-only email logging           | secret scan and log review                |
| Last-owner loss      | application invariant plus PostgreSQL advisory-lock trigger      | migration SQL review and integration test |

Service identities are represented separately from human principals and do not use browser session cookies. Full scoped service-token lifecycle remains Phase 5.

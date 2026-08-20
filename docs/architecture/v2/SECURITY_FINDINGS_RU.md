# Phase 0 Security Findings

Аудит пассивный: без brute force, fuzzing, destructive provider calls и без вывода secrets. Severity учитывает impact и вероятность эксплуатации. На момент проверки Critical не подтверждены; это не означает, что система «неуязвима».

## High

### H-01. OAuth/provider credentials хранятся plaintext в JSON

- **Evidence:** `src/ad_mcp/core/connection_store.py:20-29, 85-139, 301-411`; Meta/partner OAuth сохраняют access/refresh tokens и app credentials в connection store.
- **Сценарий:** компрометация пользователя `adforge`, backup или доступ к storage даёт повторное использование provider tokens.
- **Ремедиация:** v2 envelope encryption per secret, ключ вне БД/файла (KMS/Vault/host secret), key versioning/rotation, отдельный decrypt boundary, redacted logs и revoke workflow.
- **Regression test:** storage dump не содержит plaintext token; decrypt разрешён только connection service для правильного workspace.

### H-02. Legacy global beta token обходит tenant/account policy

- **Evidence:** `src/ad_mcp/mcp_auth.py:17-75`; beta/static token получает broad context, тогда как service token ограничен workspace/scope/accounts.
- **Сценарий:** утечка legacy token даёт доступ к данным всех доступных конфигураций и потенциально к write tool surface.
- **Ремедиация:** убрать token из customer path; заменить на scoped service tokens, break-glass только через отдельный admin control с TTL, IP policy и audit.
- **Regression test:** token workspace A не видит B; read token не вызывает write; revoked/expired token получает 401/403.

### H-03. Нет expiry у service tokens

- **Evidence:** `auth_store.py:1050-1142`; `mcp_service_tokens` хранит status/revocation/last_used, но не обязательный `expires_at`.
- **Сценарий:** забытый token остаётся действующим неограниченно долго.
- **Ремедиация:** expiry required/maximum TTL, rotation, revoke-all, hashed secret, scope/account constraints and issuance audit.
- **Regression test:** expired token denied; one-time raw value not retrievable after issuance.

## Medium

### M-01. JSON read-modify-write не координируется между workers

- **Evidence:** `connection_store.py:301-411, 589-590`; atomic replace защищает запись, но не предотвращает lost update при параллельных OAuth callbacks.
- **Impact:** потеря выбранного account/connection или смешение актуальности при одновременных запросах.
- **Remediation:** PostgreSQL transactional repository, row locks/optimistic version, idempotency key for callback.
- **Regression test:** concurrent callbacks preserve both connections and never cross workspace.

### M-02. Rate limiting частично in-process

- **Evidence:** `web/server.py:80-83, 263-297`; nginx limits существуют, но process-local map ограничен одним worker.
- **Impact:** horizontal scaling обходит application limiter; память растёт до cap, shared abuse state отсутствует.
- **Remediation:** Redis-backed fixed/sliding window, route-specific limits, trusted proxy handling and account/IP dimensions.
- **Regression test:** two app instances share quota; auth and OAuth limits produce stable 429.

### M-03. Внешние provider OAuth flows не унифицированы по PKCE

- **Evidence:** `meta_oauth.py:59-101` и `partner_oauth.py`; Meta/provider confidential flow защищён state/server state, но PKCE не общий.
- **Impact:** code interception risk зависит от provider/client deployment.
- **Remediation:** PKCE S256 wherever provider supports it; exact redirect allowlist, future-skew check, signed state secret separate from API token.
- **Regression test:** missing/wrong verifier and mismatched redirect rejected.

### M-04. Нет versioned migrations, FK, индексов и явной integrity policy

- **Evidence:** `auth_store.py:1682-1899`; inline `CREATE TABLE IF NOT EXISTS`, таблицы без полноценного FK/index strategy.
- **Impact:** unsafe schema evolution, orphan rows, slow tenant/account queries and difficult rollback.
- **Remediation:** migration tool, constraints, composite indexes, transactional deploy migrations; evaluate RLS after app policy is stable.
- **Regression test:** migration up/down/dry-run, orphan insert rejected, query plans for tenant scopes.

### M-05. Synchronous expensive work in HTTP request lifecycle

- **Evidence:** `web/server.py:1084-1172`; report/site analysis calls can run in request thread.
- **Impact:** provider latency/Playwright can exhaust workers and reduce availability.
- **Remediation:** queue job with status/result artifact, timeout, retry, concurrency and quota.
- **Regression test:** request returns job id quickly; failed job is retryable/idempotent and cannot leak other workspace artifact.

## Assurance gaps (not direct vulnerability)

- no CI workflows for type/security/secret/container/migration checks;
- no Postgres/Redis integration suite, browser E2E, provider contract suite or restore rehearsal;
- no billing/webhook/analytics domain exists;
- Hermes runtime is outside this repository, so its token boundary is not reviewable here.

## Positive controls observed

PBKDF2 password hashing with random salt; hashed sessions/reset tokens; generic auth errors; same-origin protection for session POST; CSP/HSTS/X-Frame/nosniff; trusted-host validation for Meta pagination; service token workspace/scope/account checks; global `preview_only` and Meta confirmed writes disabled in live at audit time; secrets are not tracked by Git.


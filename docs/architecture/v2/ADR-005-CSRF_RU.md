# ADR-005: Cookie authentication and CSRF

## Решение

Browser authentication использует opaque session cookie с атрибутами `HttpOnly`, `Secure` в staging/production, `SameSite=Lax`, `Path=/` и ограниченным сроком жизни. Session token хранится в базе только как HMAC-SHA-256 digest.

Для state-changing browser requests используется double-submit CSRF: сервер выставляет отдельный не-HttpOnly CSRF cookie, клиент отправляет его значение в `X-CSRF-Token`, а API дополнительно проверяет `Origin` против allowlist CORS origins. `SameSite` остаётся дополнительной защитой, но не единственной.

GET/HEAD/OPTIONS не требуют CSRF proof. Запросы без `Origin` допустимы для non-browser clients только при наличии корректного CSRF proof; будущие service identities будут использовать отдельный API/MCP policy path, а не browser cookie.

## Почему

Такой подход не помещает auth credentials в `localStorage`, поддерживает серверную ревокацию и предотвращает cross-site state changes. CSRF cookie не содержит authentication secret и не даёт доступа без session cookie.

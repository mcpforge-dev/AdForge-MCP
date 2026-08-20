# Technical Debt Report

## P0: before any v2 production cutover

1. Secret storage and key management: move provider credentials out of plaintext JSON.
2. Explicit tenant/RBAC model: active workspace, membership role, policy checks and object ownership.
3. Versioned PostgreSQL migrations with FK, indexes, uniqueness and rollback discipline.
4. Remove broad legacy MCP credential from ordinary customer path.
5. Service token expiry/rotation/revocation/audit.
6. CI gates and staging promotion path.

## P1: before feature parity

1. Queue/workers for reports, site analysis and provider sync.
2. Unified provider contract and capability registry.
3. Structured API DTOs, error model and API versioning.
4. Contract/integration/E2E/security isolation test layers.
5. Observability: structured logs, metrics, traces and error correlation.
6. Central artifact storage with workspace ownership and retention.

## P2: product expansion

1. Billing/entitlements/usage/quotas.
2. Analytics event pipeline without credentials or ad secrets.
3. Admin, notifications and incident tooling.
4. Hermes as a separately deployed consumer of scoped API.
5. Yandex/TikTok real read parity where product requirements justify it.

## Code-shape debt

`web/server.py` mixes transport, auth, orchestration, serialization and file handling. `auth_store.py` mixes repository, schema creation, OAuth token persistence and domain operations. `server.py` is registration plus global authorization wrapping. These are not reasons for a big-bang rewrite; they are seams for strangler extraction behind tests.

## Operational debt

Staging is deployed and isolated but is a detached checkout and currently has no provider connections. There is no documented automated promotion pipeline, no migration rehearsal and no verified restore test in the current repository evidence. Live and staging must remain separate while v2 is built.


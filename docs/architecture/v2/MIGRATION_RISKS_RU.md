# Migration Risks

| Risk | Impact | Likelihood | Mitigation / exit criterion |
|---|---|---:|---|
| OAuth tokens lost or invalidated | Critical | medium | encrypted re-import rehearsal, token count/hash inventory, provider smoke, rollback file retained offline |
| Workspace/account cross-link | Critical | medium | immutable workspace keys, FK, isolation tests, dual-read comparison, no frontend-only policy |
| Provider permissions drift | High | high | store granted scopes, reconnect playbook, provider contract fixtures and real staging smoke |
| v1/v2 metric mismatch | High | medium | canonical metric definitions, golden fixtures, side-by-side report comparison |
| Meta write accidentally enabled globally | Critical | low/medium | default deny, feature flag cannot bypass allowlist, explicit policy tests, no production write until sign-off |
| Session/token incompatibility | High | medium | staged session migration, dual validation window, forced rotation fallback |
| JSON-to-DB concurrency/data loss | High | medium | read-only inventory, backup, dry-run, idempotent importer, reconciliation counts |
| Large report workloads block service | High | high | queue workers, quotas, timeout and cancellation before parity cutover |
| Billing provider lock-in | High | medium | internal payment gateway interface, provider-neutral payment events |
| Current staging is not data clone | Medium | high | test fixtures/sandbox accounts and explicitly recorded parity criteria |
| Hermes boundary is unknown | High | medium | locate/separate bot repository, issue scoped service token, API contract test |
| Operational rollback not rehearsed | Critical | medium | backup/restore and reverse deploy rehearsal before cutover |

## Irreversible or expensive decisions

- changing external OAuth client IDs/callbacks and requesting new provider scopes;
- encrypting/migrating credentials without preserving a tested recovery path;
- changing external IDs or workspace/account ownership;
- committing billing transactions and subscription state;
- enabling Meta/Google writes for real customers.

## Reversible decisions

Next.js/NestJS module boundaries, queue implementation behind a job interface, payment provider selection behind an adapter, OpenTelemetry exporter, Redis topology and report template implementation are changeable if contracts remain stable.


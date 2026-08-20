# ADR-002: Prisma 7 as the application data layer

## Decision

Use Prisma 7 with PostgreSQL 18, explicit SQL migrations where needed, and PostgreSQL foreign keys, constraints and indexes as the source of integrity guarantees.

## Why

Prisma provides typed access and migration visibility for the future domain model, while the schema and SQL migration remain reviewable database artifacts. The Phase 1 schema contains only system_metadata; v1 data is not introspected or migrated.

## Rejected

- raw SQL only: loses typed application contracts;
- database abstraction without migrations: hides rollback and integrity behavior;
- importing v1 schema wholesale: creates premature coupling.

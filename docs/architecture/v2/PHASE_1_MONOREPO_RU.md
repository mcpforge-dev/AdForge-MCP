# HolyMedia MCP v2: Phase 1 foundation

## Scope

Phase 1 создаёт параллельный TypeScript foundation и не переносит функциональность v1. Production v1, staging v1, текущие OAuth connections, базы и storage не используются новой системой.

## Runtime boundaries

```text
apps/web      Next.js App Router, public/private route groups
apps/api      NestJS + Fastify, REST /api/v1, health/readiness, OpenAPI
apps/worker   BullMQ worker, isolated from HTTP lifecycle
apps/hermes   explicit placeholder; clean implementation planned for Phase 6

packages/contracts       shared API contracts
packages/config          typed environment validation
packages/database        Prisma 7 schema and migrations
packages/observability   Pino + OpenTelemetry API boundary
packages/testing         shared security-test helper
```

The repository keeps v1 src/, tests/, pyproject.toml and its deployment files intact.

## Dependency policy

Versions are pinned in package manifests and lockfile. Node.js is constrained to 24.x. Prisma 7 connection URLs are configured through prisma.config.ts, while PostgreSQL foreign keys remain database guarantees.

## Local verification

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm migrate:validate
pnpm security:secrets
pnpm security:deps
docker compose -f infra/docker-compose.v2.yml up --build
```

The compose stack uses only local development credentials and separate ports 5433, 6380, 4000, and 3000. It must never be pointed at v1 production or staging databases.

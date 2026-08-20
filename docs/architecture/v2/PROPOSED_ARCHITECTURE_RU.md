# Proposed HolyMedia MCP v2 Architecture

## Recommendation

Use a TypeScript modular monolith in a pnpm workspace. Run one deployable API, one web application and one worker process initially; keep domain modules internally separated. Docker Compose is sufficient for the current VPS scale. Do not introduce Kubernetes until measured operational needs justify it.

## Target topology

```text
CDN/TLS/Nginx
   |
Next.js web (public SEO + dashboard shell)
   |
NestJS API (Fastify, REST /api/v1, OpenAPI)
   |             |                 |
PostgreSQL     Redis/BullMQ       Provider APIs
   |             |
encrypted credentials        workers/report jobs/webhooks
```

MCP gateway is an API module or separately deployable process using the same application contracts. Hermes is a separate Telegram application that calls the scoped API/MCP gateway and never reads the database or provider credentials directly.

## Stack decision

- **Runtime:** Node.js 24 LTS at the audit date (pin the latest patched 24.x in Phase 1), TypeScript strict mode. Node.js 26 is current but not yet LTS, so it is not the production baseline.
- **Web:** current patched Next.js 16.x App Router; SSR/SSG/ISR for public content, private dashboard `noindex`.
- **API:** NestJS with Fastify adapter, REST `/api/v1`, generated OpenAPI, DTO validation.
- **Persistence:** PostgreSQL 18.x, subject to extension compatibility and a tested upgrade path, with Prisma for typed repository/migrations plus explicit SQL migrations where constraints/RLS/query tuning require it. Keep domain repositories so ORM is replaceable.
- **Async:** Redis + BullMQ; separate API/worker lifecycle, retries/backoff, idempotency and dead-letter policy.
- **Observability:** Pino structured logs, request/correlation IDs, OpenTelemetry API/SDK boundaries, metrics and error tracker adapter.
- **Testing:** Vitest unit, Supertest/contract integration, Testcontainers for PostgreSQL/Redis, Playwright E2E.
- **Security automation:** Gitleaks, Semgrep, npm audit/OSV-compatible dependency scan, Trivy image scan, migration check in CI.
- **Deploy:** Docker Compose, immutable image tags, migrations as gated job, health/readiness, backup and rollback script.

The version choice follows the projects' official support pages: [Node.js release policy](https://nodejs.org/en/about/previous-releases), [Next.js documentation](https://nextjs.org/docs), [NestJS Fastify adapter](https://docs.nestjs.com/techniques/performance) and [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/). BullMQ is appropriate for the worker boundary because its official model separates queues/workers and supports retries/backoff; see [workers](https://docs.bullmq.io/guide/workers) and [production guidance](https://docs.bullmq.io/guide/going-to-production). Exact package patch versions must be locked and scanned in CI; this document does not authorize installing them yet.

## Domain modules

Identity/Auth; Users; Organizations/Workspaces; RBAC; Providers; OAuth Connections; Advertising Accounts; Google Ads; Meta Ads; Yandex; TikTok; MCP; MCP Tools; Service Tokens; Preview/Confirmation/Commit; Hermes gateway contract; Reports; Usage; Plans; Subscriptions; Billing; Payments; Entitlements; Notifications; Audit Log; Admin; Analytics.

Each module has `domain`, `application`, `infrastructure`, `http` boundaries. Controllers do auth/DTO translation only. Provider adapters implement the common contract and are selected through a registry/capability map.

## Security architecture

- Argon2id password hashing for new credentials; opaque Redis-backed sessions with rotation and secure cookies.
- OAuth authorization code, exact callback allowlist, state, PKCE where supported, one-time transaction and granted-scope persistence.
- Envelope encryption for provider/payment secrets; key version and rotation metadata; decrypt only inside provider connection service.
- Every repository query requires workspace context; RBAC/policy check is server-side. Add FK/indexes first; evaluate Postgres RLS as defense in depth.
- Service token is hashed, scoped, workspace/account bound, expiry-required, revocable, rotatable and audited.
- Write path is `request -> policy -> preview -> one-time confirmation -> commit -> reread -> audit`.
- CSP, HSTS, secure cookies, CSRF protection, origin checks, rate limits, upload isolation, SSRF allowlist and redacted error/log pipeline.

## Billing architecture

Core billing owns plans, prices, subscription state, entitlements, usage and payment events. `PaymentProvider` is an interface; provider-specific checkout/webhook code maps into internal idempotent events. Do not select a payment provider in Phase 0.

## SEO architecture

Next metadata, canonical, robots, sitemap, OG/Twitter metadata, JSON-LD, semantic server-rendered content and status/redirect policy. Dashboard, account and report artifacts are authenticated/noindex. Public docs/product pages are independently cacheable.

## Why not split services now

The product has one team and one VPS-scale deployment. Modular boundaries plus a worker give the needed isolation without distributed transaction and deployment overhead. Reports, provider sync and Hermes are the first candidates for extraction later, because their contracts can be stabilized independently.

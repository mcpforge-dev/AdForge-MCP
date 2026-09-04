# HolyMedia MCP — финальный Code & Security Review

Дата: 2026-09-04

Проверенная ветка: `main`

Исходный commit: `b6f5638f7e087dc6b343e370a16bfc19a2ccfd5b`

Production image во время проверки: `ghcr.io/stanforge-labs/holymedia-mcp-v2:sha-9d7326dd4c8a17739217b71e0af2c15c6b8eb173`

## Executive Summary

Архитектура V2 в целом имеет правильные основные security boundaries: сессии и OAuth-токены хранятся по digest, provider credentials шифруются AES-256-GCM, provider connections разделены по workspace/provider, modern workspace routes используют server-side permissions, а Meta write ограничен отдельной точной policy.

В review найдены шесть High-проблем. Для всех подготовлены минимальные patches и regression tests, однако production всё ещё работает на старом image. Поэтому High считаются открытыми до controlled deploy нового immutable image.

| Severity | Найдено | Закрыто в коде | Открыто в production |
| -------- | ------: | -------------: | -------------------: |
| Critical |       0 |              0 |                    0 |
| High     |       6 |              6 |                    6 |
| Medium   |      10 |              1 |                    9 |
| Low      |       8 |              0 |                    8 |
| Info     |       6 |              0 |                    6 |

Verdict: **SECURITY REVIEW BLOCKED** до deploy и post-deploy regression smoke.

## Findings

### Critical

Critical findings не обнаружены. Доказанного cross-tenant compromise, plaintext production credential exposure, auth bypass системного администратора или unrestricted provider write не найдено.

### High

| ID         | Area                      | File/module                                                                             | Description / Evidence                                                                                                                                                                                                    | Impact / Exploitability                                                                                                                                                            | Fix                                                                                                                                   | Status                         |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| HM-SEC-001 | OAuth/CIMD SSRF           | `apps/api/src/mcp/oauth-client-metadata.service.ts`, `packages/site-audit/src/index.ts` | CIMD выполнял DNS pre-check, затем обычный `fetch`; DNS мог измениться между проверкой и соединением. Redirect проверялся аналогично.                                                                                     | Public OAuth client registration мог инициировать backend connection к private/link-local адресу через DNS rebinding.                                                              | Общий `safeGet`: pinned DNS lookup, socket remote-address validation, revalidation каждого redirect, HTTPS-only, 64 KiB и 4 s limits. | FIXED_IN_CODE / DEPLOY_PENDING |
| HM-SEC-002 | Legacy Site Analysis SSRF | `apps/api/src/site-analysis/site-analysis.service.ts`                                   | Legacy endpoint делал DNS check отдельно от native fetch и читал body до проверки размера.                                                                                                                                | Authenticated user мог попытаться достигнуть internal service через DNS rebinding или вызвать memory pressure большим body.                                                        | Переведён на тот же pinned `safeGet`, 1.5 MiB, 15 s, 3 redirects.                                                                     | FIXED_IN_CODE / DEPLOY_PENDING |
| HM-SEC-003 | Legacy provider RBAC      | `apps/api/src/compat/legacy-hosted.controller.ts`                                       | `POST /api/hosted/:provider/connect` требовал только valid session; MEMBER/VIEWER мог начать OAuth и заменить workspace provider credential.                                                                              | Внутри tenant пользователь без `connections.manage` мог изменить критичную integration state.                                                                                      | Server-side ACTIVE + OWNER/ADMIN gate; negative RBAC tests.                                                                           | FIXED_IN_CODE / DEPLOY_PENDING |
| HM-SEC-004 | Legacy service-token RBAC | `apps/api/src/compat/legacy-mcp-token.controller.ts`                                    | Legacy list/create/rotate/revoke routes обходили modern `mcp.tokens.manage` permission.                                                                                                                                   | MEMBER/VIEWER мог выпускать или отзывать machine credentials workspace.                                                                                                            | Server-side ACTIVE + OWNER/ADMIN gate для всего legacy token facade; direct-call tests.                                               | FIXED_IN_CODE / DEPLOY_PENDING |
| HM-SEC-005 | MCP account restriction   | `apps/api/src/mcp/mcp.service.ts`                                                       | Account-restricted token проходил проверку одного Meta ad account, после чего connection-wide business/page tools принимали произвольные business/page IDs. GSC list/report мог вообще не вызывать account authorization. | Machine token с узким account allowlist мог прочитать другие assets той же provider credential. Cross-workspace доступ не доказан, но documented account boundary обходился.       | Connection-wide Meta/GSC reads запрещены restricted tokens; GSC report требует конкретную разрешённую property. 11 negative tests.    | FIXED_IN_CODE / DEPLOY_PENDING |
| HM-SEC-006 | Runtime dependency        | `pnpm-workspace.yaml`, `pnpm-lock.yaml`                                                 | `fast-uri` advisory допускал host interpretation confusion в validation dependency. Дополнительно обнаружены Fastify validation/proxy advisories и неиспользуемый mysql2 advisory.                                        | User-controlled URL/schema validation проходит через runtime dependency; Fastify находится на public API boundary. mysql2 не exploitable, поскольку runtime использует PostgreSQL. | Pinned safe versions: fast-uri 3.1.6/4.1.3, Fastify 5.12.1, mysql2 3.23.1. `pnpm audit`: 0 advisories.                                | FIXED_IN_CODE / DEPLOY_PENDING |

### Medium

| ID         | Area                     | File/module                                                                                             | Description / Evidence                                                                                                                                                                                           | Impact / Exploitability                                                                      | Fix                                                                                                                                       | Status                         |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| HM-SEC-101 | Disabled Site Audit      | `apps/api/src/site-audits/site-audit.service.ts`, `apps/api/src/site-analysis/site-analysis.service.ts` | UI показывал Coming Soon, но authenticated caller мог вызвать backend и enqueue Chromium/Lighthouse work.                                                                                                        | Authenticated resource exhaustion and provider cost risk.                                    | `SITE_AUDIT_PRODUCT_ENABLED=false` by default; both modern and legacy create paths fail closed.                                           | FIXED_IN_CODE / DEPLOY_PENDING |
| HM-SEC-102 | MCP schemas/ranges       | `apps/api/src/mcp/mcp.service.ts`                                                                       | Из 156 tools около 150 используют generic object schema; common date helpers не валидируют календарную дату и maximum span.                                                                                      | Invalid/very wide reports могут расходовать quota/CPU и давать inconsistent provider errors. | Typed schemas, strict date parser, provider-specific maximum ranges.                                                                      | BACKLOG                        |
| HM-SEC-103 | Admission/rate limiting  | MCP, OAuth DCR, report and queue entry points                                                           | Login/admin имеют Redis fail-closed limits, Nginx ограничивает OAuth по IP, но нет единого per-principal budget для MCP/DCR/report generation.                                                                   | Authenticated token или распределённые IP могут создавать quota/availability pressure.       | Redis per-token/workspace limits and queue admission caps.                                                                                | BACKLOG                        |
| HM-SEC-104 | Provider response bounds | `apps/api/src/providers/provider-http.ts`                                                               | `response.json()` buffers provider body без byte limit. Endpoints fixed and trusted, поэтому immediate exploitability ниже, чем у SSRF.                                                                          | Compromised/misbehaving upstream может вызвать memory pressure.                              | Stream/Content-Length limit and abort before JSON parse.                                                                                  | BACKLOG                        |
| HM-SEC-105 | Dormant Python V1 SSRF   | `src/ad_mcp/tools/site_analysis.py`                                                                     | V1 performs `getaddrinfo` validation then urllib opens by hostname; redirect targets re-check but socket DNS is not pinned. V1 process is not the deployed production runtime.                                   | Latent SSRF if archived Python server is started again.                                      | Remove/decommission V1 executable surface or port pinned fetcher.                                                                         | BACKLOG                        |
| HM-SEC-106 | Backup permissions       | `/var/backups/adforge-mcp/**`                                                                           | Several PostgreSQL dumps are mode 0644; encrypted legacy credential backups are mostly 0600.                                                                                                                     | Any future unprivileged host account could read customer DB backups.                         | Enforce root:root 0600, encrypted off-host retention, periodic restore test.                                                              | BACKLOG                        |
| HM-SEC-107 | VPS SSH/firewall         | production VPS                                                                                          | `passwordauthentication yes`, `x11forwarding yes`, UFW inactive; root login is key-only. Public listeners observed only 22/80/443.                                                                               | Enlarged host attack surface; mitigated by current listener set and key-only root.           | Disable password auth/X11 after access rehearsal; enable explicit firewall policy.                                                        | BACKLOG                        |
| HM-SEC-108 | CI supply chain          | `.github/workflows/*.yml`                                                                               | GitHub Actions use movable major tags; production build explicitly sets `provenance: false`, `sbom: false`.                                                                                                      | Compromised upstream action tag or weak artifact traceability.                               | Pin actions by commit SHA; enable SBOM/provenance and sign immutable image.                                                               | BACKLOG                        |
| HM-SEC-109 | CI default branch red    | GitHub Actions for `b6f5638...`                                                                         | Compose/image pass; foundation failed at a stale worker expectation and browser workflow expected obsolete `/dashboard?section=connections` OAuth redirects. Full format check has 18 pre-existing files.        | Broken merge signal can hide future regressions.                                             | Candidate patch fixes both stale expectations; compatibility smoke now passes 15/15 against production. Baseline formatting debt remains. | PARTIAL_IN_CODE / BACKLOG      |
| HM-SEC-110 | Container hardening/disk | `infra/Dockerfile.v2`, `infra/docker-compose.v2.production.yml`                                         | App runs as `node`, DB/Redis are loopback-only and logs rotate. Root filesystem remains writable; no cap-drop/no-new-privileges; one image contains all deps and Chromium (4.6 GB virtual). VPS has 4.8 GB free. | Defense-in-depth gap and operational disk-pressure risk.                                     | Split runtime stages/images; read-only root where possible; tmpfs; cap-drop; retain rollback headroom.                                    | BACKLOG                        |

### Low

| ID         | Area                      | Evidence                                                                                                             | Recommendation                                                                  | Status  |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| HM-SEC-201 | CSP                       | Production CSP allows inline script/style for current Next/theme bootstrap.                                          | Move bootstrap to nonce/hash policy and remove `unsafe-inline`.                 | BACKLOG |
| HM-SEC-202 | OAuth metadata config     | Well-known controller hardcodes production issuer/resource instead of config.                                        | Generate metadata from validated `PUBLIC_ORIGIN`/issuer.                        | BACKLOG |
| HM-SEC-203 | Legacy diagnostics drift  | V1 diagnostics always reports preview-only/live-writes-disabled, while narrow Meta App Review policy can be enabled. | Report actual sanitized policy state.                                           | BACKLOG |
| HM-SEC-204 | Migration naming          | Two migrations share numeric prefix `0020`; Prisma applies by full lexical name.                                     | Enforce unique monotonically increasing migration prefixes.                     | BACKLOG |
| HM-SEC-205 | Log redaction hardening   | Current log call sites are sanitized; redaction policy relies mainly on exact paths.                                 | Add recursive redaction for authorization/cookie/token-like keys.               | BACKLOG |
| HM-SEC-206 | Login timing              | Generic errors and Redis limits are present, but Argon2 is only executed for an existing user.                       | Use a fixed dummy hash for unknown emails.                                      | BACKLOG |
| HM-SEC-207 | Provider discovery worker | Provider-discovery queue processor primarily records/logs instead of running the complete sync path.                 | Either wire it to the canonical sync service or remove the unused queue.        | BACKLOG |
| HM-SEC-208 | Legacy surface            | Python V1 server/static UI and many compatibility routes remain in repository/image.                                 | Inventory consumers, set removal date, delete unreachable code after migration. | BACKLOG |

### Info / coverage limits

| ID         | Item                               | Result                                                                                                                                                                                    |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HM-SEC-301 | Authenticated production MCP smoke | Not executed: no plaintext production token was available, and review rules prohibited creating a persistent test credential. Unauthenticated `/mcp` correctly returned 401.              |
| HM-SEC-302 | Clean PostgreSQL 18 migration      | Prisma validate and production applied-migration inventory passed; a new clean DB was not created on production. Latest public Compose workflow passed.                                   |
| HM-SEC-303 | Secret tooling                     | Repository/current-tree scan and high-confidence scan of 406 Git commits found no credential candidate. Gitleaks binary was unavailable locally; the repository's own secret gate passed. |
| HM-SEC-304 | Google verification                | Sensitive GA4/GSC scopes may still show Google's unverified-app warning; this is an operational OAuth review item, not an authentication bypass.                                          |
| HM-SEC-305 | Provider live reads                | Connection/account integrity and recent provider states were checked in DB without secrets. New provider API requests were intentionally not generated during this security review.       |
| HM-SEC-306 | Formatting                         | Security-changed files pass Prettier; repository-wide format gate reports 18 pre-existing files.                                                                                          |

## Architecture / Boundaries

- V2 is a modular Nest/Fastify API with separate Web and BullMQ Worker processes and shared typed packages.
- Modern controllers consistently combine `AuthenticationGuard`, `WorkspaceAuthorizationGuard`, and explicit permissions.
- Legacy compatibility is the main boundary-risk area. Two proven RBAC bypasses were patched; remaining V1 code should be retired, not expanded.
- Runtime config supports V1 fallback aliases. This helps migration but increases hidden coupling; production callback and write flags must remain declared in canonical compose/env management.

## Tenant isolation

- Production integrity queries found zero ProviderAccount rows whose workspace/provider differed from their ProviderConnection, zero orphan credentials, zero orphan service tokens, and zero workspaces without an owner.
- Database constraints include composite ProviderAccount → ProviderConnection `(connectionId, workspaceId, provider)` and workspace-scoped uniqueness.
- Site Audit detail, screenshots and reports query by both audit ID and workspace ID.
- Confirmed issue HM-SEC-005 allowed account-scope widening inside the same credential; fixed fail-closed. No proven cross-workspace read/write remained in reviewed V2 code.

## Auth / OAuth

- Sessions: opaque random values, HMAC digest at rest, HttpOnly/Secure/SameSite cookies, revocation and expiry.
- Passwords: Argon2id with bounded legacy PBKDF2 migration.
- CSRF: global Origin + double-submit enforcement for cookie mutations; machine Bearer/OAuth endpoints use their protocol bindings.
- MCP OAuth: PKCE S256, exact redirect binding, one-time authorization codes, hashed access/refresh tokens, rotating refresh families and replay-family revocation.
- Provider OAuth state: HMAC/digest, one-use atomic consume, 10-minute expiry, user/session/workspace/provider binding, encrypted PKCE verifier.
- CIMD is now HTTPS-only and protected by pinned DNS/redirect checks.

## Provider isolation

| Provider              | Result                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google Ads            | Independent `GOOGLE_ADS` connection/credential/callback; account-scoped reads.                                                                                                                                                 |
| Google Analytics      | Independent `GOOGLE_ANALYTICS` credential and property selection; does not replace Ads/GSC credential.                                                                                                                         |
| Google Search Console | Independent callback/credential/property rows. Account-restriction bypass in MCP fixed.                                                                                                                                        |
| Meta Ads              | Reads are tenant/account scoped. Generic confirmed writes are disabled in production. Narrow App Review rename still requires write scope + exact policy + PAUSED pre/post read. Connection-wide restricted-token reads fixed. |
| TikTok Ads            | OAuth/discovery parser keeps advertiser IDs as strings and reads v1.3 `data.list`; no write tools enabled. Legacy compatibility remains technical debt.                                                                        |
| Yandex Direct         | Independent connection/credential; reviewed path is read-only.                                                                                                                                                                 |

## MCP

- 156 tool names are returned for V1 compatibility.
- Authentication accepts hashed service tokens or hashed MCP OAuth access tokens; revoked/expired identities, users, memberships and workspaces fail closed.
- Service-token account IDs are internal ProviderAccount IDs, with workspace/provider checks before provider calls.
- Write tools are explicitly classified; no provider write was performed during review.
- Schema/date strictness and connection-wide tool semantics are the main remaining hardening backlog.

## Admin / Billing

- `/admin` uses a separate short-lived Strict admin session and server-side `AdminAuthenticationGuard`.
- Lifetime/full access assignment is an entitlement operation behind admin guard; client/workspace-owner direct endpoint access is denied in tests.
- Billing/entitlement checks are server-side; customer-facing `legacy_internal` labels are presentation-only and not an authorization source.
- Sensitive admin/token/provider-connect actions have audit events; metadata reviewed does not include secrets.

## Database / Credentials

- Provider credentials and OAuth PKCE state use AES-256-GCM keyring encryption.
- Service, session and OAuth tokens are stored as digest, not retrievable plaintext.
- Prisma schema validates; all migrations `0001`–`0029` were present in production.
- Cascade/restrict relations are generally tenant-safe. Backup file permissions require hardening (HM-SEC-106).

## API / Web / Files

- Fastify body limit: 3 MiB; validation uses whitelist + reject unknown DTO fields.
- CORS is credentialed but restricted to configured production origins; security headers and TLS 1.2/1.3 are active.
- Frontend stores only theme/language preferences in localStorage, not auth/provider tokens.
- Deep-link return path is normalized to same-origin dashboard routes.
- DOCX/PPTX/Site Audit artifact endpoints perform workspace authorization; filenames are server-generated.
- Telegram feedback escapes HTML and normalizes page links to the HolyMedia origin.

## Worker / Queues

- BullMQ payloads carry IDs/workspace context, not provider secrets.
- Site Audit queue has bounded crawl/sample settings and pinned outbound HTTP/browser routing.
- Site Audit is now denied at the API before enqueue while product-disabled.
- Per-workspace queue admission and global job flood limits remain backlog.

## Infrastructure

- Production health: `/health=200`, `/ready=200`, unauthenticated `/mcp=401`.
- API/Web/Worker, PostgreSQL 18 and Redis are healthy. API/Web/Worker use the same immutable image and run as `node`.
- PostgreSQL/Redis are bound to loopback; public listeners observed: SSH 22, HTTP 80, HTTPS 443.
- TLS certificate valid; only TLS 1.2/1.3 accepted in review checks.
- Docker JSON logs have rotation; system journal uses 152 MiB.
- Disk: 20 GB total, 14 GB used, 4.8 GB free. Current app image virtual size is approximately 4.6 GB.

## Dependencies / CI-CD

- Candidate lockfile `pnpm audit`: 0 Critical/High/Moderate/Low advisories.
- Secrets are supplied through GitHub/VPS env files, not Docker build args. No secret was found in current image configuration inspected.
- Workflow permissions are narrow (`contents: read`; production image additionally `packages: write`), and no `pull_request_target` workflow exists.
- Actions are not SHA-pinned and image provenance/SBOM are disabled.
- Public workflow state for source baseline: Compose and image jobs pass; foundation/browser jobs are red and must be restored before release promotion.

## Automated checks

| Check                                   | Result                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Changed-file Prettier                   | PASS                                                                                              |
| Repository format check                 | FAIL — 18 pre-existing files                                                                      |
| ESLint                                  | PASS                                                                                              |
| TypeScript typecheck                    | PASS                                                                                              |
| TypeScript unit tests                   | PASS — API 180 passed/19 skipped; worker 10 passed/2 integration skipped; remaining packages pass |
| Python legacy tests                     | PASS — 238 passed/1 skipped after installing declared optional `python-docx` dependency           |
| Production build                        | PASS                                                                                              |
| Prisma validate                         | PASS                                                                                              |
| Migration inventory                     | PASS on production; clean local PostgreSQL not available                                          |
| Dependency audit                        | PASS — 0 advisories                                                                               |
| Repository secret scan                  | PASS                                                                                              |
| Git history high-confidence secret scan | PASS — 406 commits, 0 candidates                                                                  |
| Compose smoke                           | PASS on latest public baseline workflow                                                           |
| Production passive smoke                | PASS — health/ready/unauth MCP; compatibility smoke 15/15                                         |

## Accepted risks

1. Meta App Review controlled rename remains enabled only through exact server policy; generic confirmed write and generic allowlists are empty/false.
2. Google OAuth sensitive-scope verification warning is accepted for internal testing pending formal Google review.
3. Legacy compatibility remains temporarily shipped, but newly identified mutation bypasses are gated in the candidate patch.
4. Nginx/IP limiting remains part of current defense while per-principal MCP admission control is backlog.

## Required release action

1. Review and push the security commit.
2. Require candidate CI to pass foundation, Compose, browser compatibility and image workflows.
3. Deploy one immutable image to API/Web/Worker without restarting PostgreSQL/Redis.
4. Verify `/health`, `/ready`, `/mcp` 401, legacy MEMBER/VIEWER 403, restricted Meta/GSC tool denial, CIMD private/redirect denial, and Site Audit create 503 while disabled.
5. Only after this post-deploy smoke can open High count become zero.

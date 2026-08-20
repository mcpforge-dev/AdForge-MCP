# ADR-004: Redis and BullMQ

## Decision

Use Redis as the v2 queue transport and BullMQ for background jobs. The worker is a separate runtime from the API HTTP lifecycle.

## Why

BullMQ provides retries, concurrency, delayed jobs and job lifecycle metadata suitable for reports, provider sync and notifications. The foundation validates connection, graceful shutdown and a safe internal job without introducing a second service.

## Guardrails

Jobs must be idempotent, carry tenant context explicitly, avoid secrets in payloads and use bounded retries with a dead-letter policy added when domain jobs arrive.

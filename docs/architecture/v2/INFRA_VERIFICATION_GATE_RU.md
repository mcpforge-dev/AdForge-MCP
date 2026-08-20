# Phase 1 infrastructure verification gate

До первого staging deployment v2 обязательно подтвердить на реальном runtime:

- Docker Compose startup;
- PostgreSQL connectivity;
- Redis connectivity;
- выполнение `foundation.ping` worker job;
- `/health` и `/ready` API со всеми зависимостями;
- применение Prisma migrations на PostgreSQL.

Phase 2 добавляет этот gate в CI через PostgreSQL и Redis service containers. Локальная проверка Compose остаётся обязательной перед staging rollout, даже если CI проходит.

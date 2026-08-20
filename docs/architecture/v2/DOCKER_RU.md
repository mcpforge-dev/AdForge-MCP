# V2 Docker Compose

infra/docker-compose.v2.yml defines five isolated local services:

- PostgreSQL 18;
- Redis 7.4;
- NestJS API;
- BullMQ worker;
- Next.js web.

The API applies only v2 Prisma migrations before starting. The worker is a separate process and submits one safe foundation.ping job to verify queue processing. There is no v1 volume, env file, network or credential mount.

Phase 1 does not deploy this compose stack to VPS. Production images and rollout policy belong to later infrastructure phases.

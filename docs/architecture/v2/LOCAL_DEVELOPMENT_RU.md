# V2 local development

## Requirements

- Node.js 24 LTS;
- pnpm 11.1.3;
- Docker Engine/Desktop with Compose;
- Git.

## Start

```powershell
Copy-Item .env.v2.example .env.v2
pnpm install --frozen-lockfile
pnpm dev
```

For a reproducible dependency environment:

```powershell
docker compose -f infra/docker-compose.v2.yml up --build
```

## Service URLs

- web: http://localhost:3000;
- web health: http://localhost:3000/api/health;
- API health: http://localhost:4000/health;
- API readiness: http://localhost:4000/ready;
- API OpenAPI UI in non-production: http://localhost:4000/docs;
- PostgreSQL: localhost:5433;
- Redis: localhost:6380.

The local database and Redis volumes belong only to v2. Do not reuse v1 .env, connections.json, tokens, OAuth credentials or VPS databases.

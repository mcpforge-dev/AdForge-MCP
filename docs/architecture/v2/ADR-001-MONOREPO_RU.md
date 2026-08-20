# ADR-001: pnpm workspaces and Turborepo

## Decision

Use pnpm workspaces with Turborepo for the v2 modular monolith.

## Why

The web, API, worker and future Hermes runtime need independent build and deploy boundaries while sharing typed contracts, configuration, database and observability packages. pnpm gives deterministic workspace dependency resolution; Turborepo gives task ordering and caching without introducing microservice infrastructure.

## Rejected

- separate repositories now: weakens atomic contract changes;
- npm workspaces alone: no task graph/cache;
- Nx: unnecessary platform complexity at the current scale;
- microservices/Kubernetes: no measured need.

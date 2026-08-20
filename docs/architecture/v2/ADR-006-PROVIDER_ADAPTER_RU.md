# ADR-006: provider adapter architecture

## Решение

Использовать централизованный registry и общий `ProviderOAuthAdapter` contract. Provider-specific OAuth/discovery/refresh/revoke код не размещается в controller или identity modules.

## Причина

Новые providers добавляются одной registry entry и adapter без изменения tenancy/RBAC/auth. Test Provider даёт безопасную contract surface до миграции Google/Meta.

## Ограничение

Phase 3 не объявляет Google/Meta read/write capability готовой: metadata показывает `read=false`, `write=false`, пока Phase 4 не добавит реальные adapters.

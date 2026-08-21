# Product analytics V2

Product analytics хранится отдельно от security audit log. Audit фиксирует
действия и отказы для расследований, а `product_events` содержит только
allowlisted продуктовые события для агрегированной статистики workspace.

## Безопасность данных

- запись и чтение всегда проверяют membership и RBAC текущего workspace;
- клиент может отправить только известное имя события;
- properties допускают не более 20 scalar-полей;
- ключи, похожие на token, secret, password, cookie, session, email, phone,
  credential или advertising account/customer ID, отклоняются;
- вложенные объекты, массивы и длинные строки отклоняются;
- сырые provider responses и credentials в analytics не записываются;
- ADMIN/OWNER получают только агрегаты, а не межклиентский список событий.

## API

- `POST /api/v1/workspaces/:id/analytics/events`;
- `GET /api/v1/workspaces/:id/analytics/summary?days=30`.

Период summary ограничен диапазоном 1-90 дней. Tenant isolation обеспечивается
общим `WorkspaceAuthorizationGuard` и обязательным `workspace_id` в каждом
запросе к таблице.

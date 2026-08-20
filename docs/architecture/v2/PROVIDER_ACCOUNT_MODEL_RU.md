# Provider account model

`ProviderConnection` описывает OAuth connection workspace к платформе. На connection допускается один credential row и один provider на workspace. `ProviderAccount` нормализует обнаруженные внешние рекламные кабинеты и хранит server-side `enabled` selection.

Все queries требуют workspace scope. API не доверяет workspace ID как доказательству доступа: перед controller работает Phase 2 membership/permission guard, а service дополнительно фильтрует resource query по workspace. Исторические accounts не удаляются при disconnect, но операции через disconnected connection запрещаются.

Discovery выполняется через adapter contract и имеет BullMQ job boundary. В Phase 3 worker проверяет очередь и deduplication; фактические Google/Meta discovery adapters появятся в Phase 4.

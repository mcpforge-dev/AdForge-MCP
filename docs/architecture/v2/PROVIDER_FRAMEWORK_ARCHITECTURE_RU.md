# Provider Framework v2

Phase 3 вводит единый контур `ProviderRegistry -> ProviderOAuthAdapter -> ProviderService`.
Controllers знают только provider-neutral API. OAuth, discovery, refresh и revoke находятся в adapter, а credentials никогда не передаются во frontend.

Поддерживаемые идентификаторы: `GOOGLE_ADS`, `META_ADS`, `YANDEX_DIRECT`, `TIKTOK_ADS`. `TEST_PROVIDER` доступен только вне production и используется CI для проверки полного жизненного цикла.

Каждый connection принадлежит workspace и имеет отдельную encrypted credential row. Нормализованные ProviderAccount rows сохраняют внешний account ID, статус, валюту, timezone и ограниченные metadata. Включение account хранится на сервере.

Google и Meta в этой фазе представлены только metadata/конфигурацией. Реальные API adapters и business logic переносятся в Phase 4.

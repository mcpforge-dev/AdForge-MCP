# V1 provider migration analysis

Миграция в Phase 3 не выполняется. Документ фиксирует контракт для будущего repeatable dry-run importer.

## Google Ads

V1 хранит connection metadata и OAuth/provider credentials в connection store (`src/ad_mcp/core/connection_store.py`, encrypted credential helpers и runtime env/config). В payload встречаются OAuth access/refresh token, expiry/scopes, customer IDs, manager/login customer ID и developer token. В v2 это отображается в `ProviderConnection(provider=GOOGLE_ADS)`, `ProviderCredential` и `ProviderAccount.externalAccountId`; manager/customer hierarchy становится ограниченным provider metadata.

Повторяемый импорт должен нормализовать customer IDs, не дублировать по `(workspace, provider, external_account_id)`, проверять владельца workspace и не переносить plaintext. Developer token остаётся application secret и не должен стать workspace credential без отдельного решения.

## Meta Ads

V1 хранит encrypted Meta user access token и metadata подключённых ad accounts/Business/Page/Instagram в connection storage и OAuth runtime. В v2 это отображается в `ProviderConnection(provider=META_ADS)`, encrypted `ProviderCredential` и normalized `ProviderAccount`; Business/Page/Instagram сохраняются только в ограниченном metadata до Phase 4 provider adapter.

Импорт должен сохранить external IDs и granted/requested scopes, пометить missing permissions и не считать старые tokens гарантированно действующими. App Review scopes и reconnect policy проверяются отдельным smoke test.

## Migration contract

`v1 connection -> v2 ProviderConnection -> v2 ProviderCredential -> v2 ProviderAccount`. Алгоритм: `dry-run -> backup -> counts -> idempotent upsert -> FK validation -> encrypted credential decrypt/re-encrypt -> provider smoke -> approval`. Production migration и перенос v1 tokens в Phase 3 не выполнялись.

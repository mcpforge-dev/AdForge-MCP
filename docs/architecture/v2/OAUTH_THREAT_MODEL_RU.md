# OAuth threat model

| Угроза                          | Контроль                                           | Тест                     |
| ------------------------------- | -------------------------------------------------- | ------------------------ |
| Forged state                    | криптографический opaque state, в БД только digest | invalid state            |
| Replay callback                 | атомарное consume и `consumed_at`                  | повторный callback       |
| Wrong workspace/provider        | state binding + server-side membership             | wrong workspace/provider |
| Session swapping                | state связан с session ID                          | wrong session            |
| Open redirect                   | redirect URI только из server config               | manipulated redirect     |
| Authorization code interception | PKCE capability для поддерживающих providers       | verifier required        |
| Credential disclosure           | AES-GCM, redacted logs, safe errors                | ciphertext/secret scan   |
| OAuth flood                     | Redis distributed rate limits                      | repeated start/discovery |
| Refresh storm                   | Redis lock per connection, TTL и bounded wait      | concurrent refresh       |

OAuth client secrets являются application configuration и не сохраняются в connection metadata.

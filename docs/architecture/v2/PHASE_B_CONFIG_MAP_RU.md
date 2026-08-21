# Phase B: V1 → V2 production configuration map

Values are intentionally omitted. The map is for a controlled secret-manager or systemd environment migration.

| V1 configuration                      | V2 destination                                  | Migration rule                                                                   |
| ------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Public base URL / MCP URL             | `PUBLIC_BASE_URL`, `MCP_PUBLIC_URL`             | preserve `https://mcp.holymedia.kz` and `/mcp`                                   |
| Google OAuth client and redirect path | provider Google config                          | reuse existing client and `/oauth/google/callback`                               |
| Meta App ID/secret and redirect path  | provider Meta config                            | reuse existing app and `/oauth/meta/callback`                                    |
| Yandex/TikTok OAuth app config        | provider adapter config                         | reuse existing apps and callback paths                                           |
| Google Ads developer token            | Google provider secret                          | server-only; never DB/frontend/logs                                              |
| V1 Fernet credential key              | migration runtime only                          | decrypt only in memory, then AES-256-GCM V2 envelope                             |
| V2 provider key ring                  | `PROVIDER_CREDENTIAL_ENCRYPTION_KEYS`           | separate keyring, current version explicit, old version retained during rotation |
| V1 auth DB                            | V2 PostgreSQL migration source                  | source read-only; no in-place writes                                             |
| V1 `connections.json`                 | sanitized export + controlled credential bridge | never copy plaintext or raw file into V2                                         |
| V1 service-token SHA-256 digest       | V2 `ServiceToken.tokenDigest`                   | preserve digest and restrictions; plaintext token is not required                |
| SMTP / Telegram                       | V2 server/worker env                            | values copied only through secret manager                                        |
| Billing                               | V2 plan/entitlement data                        | existing workspaces receive legacy/internal entitlement                          |

No new OAuth application, callback URI, DNS record or public hostname is part of this map.

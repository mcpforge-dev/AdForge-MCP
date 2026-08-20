# Credential security

Provider credentials хранятся в `provider_credentials.encrypted_payload`. Используется AES-256-GCM Node.js с уникальным 96-bit nonce и authentication tag. В БД хранится ciphertext и integer `encryption_version`, ключи находятся только в environment/secret manager вне БД.

Формат key ring: `version:base64-32-byte-key[,version:...]`. Текущий ключ выбирается `PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION`. Старые ключи остаются для расшифровки во время rotation; `reencrypt()` создаёт ciphertext на текущем ключе без reconnect.

Plaintext существует только в памяти процесса. Logger redaction закрывает access/refresh token и общие token-поля. Ошибки и metrics не содержат credential payload. Production-like configuration требует явно заданный key ring.

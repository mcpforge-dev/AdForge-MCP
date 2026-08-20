# ADR-007: credential encryption

Использовать Node.js `aes-256-gcm` с random nonce и authentication tag. Это стандартная authenticated-encryption primitive без отдельной криптобиблиотеки и с поддержкой key version в схеме.

Ключи поставляются вне репозитория и БД. Key ring позволяет расшифровывать старую версию и re-encrypt на текущую без переподключения. Ошибка аутентификации ciphertext не раскрывает содержимое.

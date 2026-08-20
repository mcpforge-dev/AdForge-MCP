# ADR-008: OAuth state and PKCE

State генерируется server-side, в БД хранится только HMAC-like digest через существующий session hash secret. State связывает user/workspace/provider/session, истекает через 10 минут и поглощается один раз.

PKCE не навязывается всем providers: adapter декларирует capability. Для Test Provider используется S256 и verifier хранится encrypted server-side. Redirect URI не берётся из запроса браузера.

# OAuth architecture

Старт OAuth доступен только authenticated user с `connections.manage` для workspace. Server-side state содержит только digest в БД и связан с user, workspace, provider и session. Значение state одноразовое, живёт 10 минут и поглощается атомарным `updateMany`.

PKCE включается adapter capability. Test Provider требует `S256`; Google/Meta пока не реализованы в v2 adapter. Redirect URI выбирается серверной конфигурацией и не принимается от браузера. Callback принимает только state/code, проверяет session и provider, после чего в одной транзакции обновляет connection, credentials и consumes state.

Denial, missing code, invalid/expired/replayed state и неверный provider обрабатываются безопасно. После callback v2 возвращает JSON API result; UI может показать connection status и scopes.

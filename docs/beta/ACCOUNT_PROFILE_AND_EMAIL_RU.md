# Account Profile и Email Reset

Этот документ описывает рабочий аккаунт-функционал AdForge MCP beta: профиль, никнейм, аватар, смену пароля и восстановление доступа через email.

## Возможности

- `GET /api/profile` возвращает безопасный профиль пользователя.
- `PUT /api/profile` обновляет никнейм.
- `POST /api/profile/change-password` меняет пароль после проверки текущего пароля.
- `POST /api/profile/avatar` загружает аватар.
- `POST /api/auth/forgot-password` создаёт reset token и отправляет email.
- `POST /api/auth/reset-password` меняет пароль по reset token.

## SMTP env

Для реальной отправки писем на VPS нужно добавить в `/etc/adforge-mcp/adforge-mcp.env`:

```env
AD_MCP_SMTP_HOST=
AD_MCP_SMTP_PORT=587
AD_MCP_SMTP_USERNAME=
AD_MCP_SMTP_PASSWORD=
AD_MCP_SMTP_FROM_EMAIL=
AD_MCP_SMTP_FROM_NAME=AdForge MCP
AD_MCP_SMTP_USE_TLS=true
AD_MCP_SMTP_USE_SSL=false
AD_MCP_PASSWORD_RESET_TTL_MINUTES=30
```

Не коммитить реальные SMTP значения. Не выводить SMTP password в чат, logs или screenshots.

Если SMTP не настроен, UI показывает понятный статус: отправка письма временно недоступна. Код при этом готов к работе сразу после добавления env и перезапуска services.

## Reset token security

- Пользователь вводит email, но ответ всегда нейтральный: система не раскрывает, существует аккаунт или нет.
- Raw reset token используется только в reset-ссылке email.
- В базе хранится только SHA-256 hash reset token.
- Token одноразовый.
- Token имеет TTL.
- После успешного reset старые reset tokens и активные sessions пользователя инвалидируются.
- Новый пароль сохраняется только как PBKDF2 hash.

## Avatar upload security

Env:

```env
AD_MCP_PROFILE_UPLOAD_DIR=/var/lib/adforge-mcp/uploads
AD_MCP_PROFILE_MAX_AVATAR_BYTES=2097152
```

Ограничения:

- разрешены только JPG/JPEG, PNG, WEBP;
- проверяются extension, MIME type и magic bytes;
- SVG/HTML/JS/PHP/EXE не принимаются;
- оригинальное имя файла не используется;
- physical path сервера не возвращается наружу;
- клиент получает только `avatar_url`.

VPS directory:

```bash
sudo mkdir -p /var/lib/adforge-mcp/uploads
sudo chown -R adforge:adforge /var/lib/adforge-mcp/uploads
sudo chmod 750 /var/lib/adforge-mcp/uploads
```

После изменения env или прав:

```bash
sudo systemctl restart adforge-mcp-web adforge-mcp-http
```

## Client UI

В профиле доступны:

- редактирование никнейма;
- загрузка аватара;
- смена пароля;
- безопасная сводка аккаунта без role/workspace/password hash.

На экране входа доступно:

- `Забыли пароль?`;
- форма ввода email;
- reset page `/reset-password?token=...`;
- форма нового пароля.

## Diagnostics

Diagnostics/capabilities могут показывать только safe flags:

- `smtp_configured`;
- `profile_editing_enabled`;
- `avatar_upload_enabled`;
- `password_reset_enabled`;
- `password_change_enabled`.

Запрещено показывать SMTP host, username, password, reset token, upload physical path или password hash.

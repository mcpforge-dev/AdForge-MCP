# AdForge MCP — roadmap русификации, регистрации, клиентской панели, админки и базы данных

## 1. Контекст проекта

AdForge MCP — hosted MCP-сервис для подключения рекламных кабинетов к AI-клиентам: Codex, Claude и другим MCP-compatible инструментам.

Текущая beta-архитектура:

- сайт / dashboard уже развернут как hosted сервис;
- пользователь вводит beta token / access code;
- после входа видит dashboard;
- может подключать рекламные платформы через OAuth;
- выбирает рекламные аккаунты;
- копирует MCP URL;
- вставляет MCP URL в Codex / Claude;
- использует AI для чтения рекламных кабинетов, кампаний, бюджетов, статусов и базовых метрик;
- опасные действия работают только в preview-only mode.

Текущая проблема:

- beta token — временная заглушка;
- клиентский UX пока выглядит технически;
- нет регистрации пользователей;
- нет профиля;
- нет личного кабинета как нормального SaaS;
- нет админской панели;
- нет управления пользователями;
- нет нормальной базы данных для пользователей, ролей, сессий, workspace и подключений;
- интерфейс сейчас частично на английском, а первые клиенты будут русскоязычные.

Целевой путь клиента:

1. Заходит на сайт.
2. Регистрируется по email.
3. Входит в аккаунт.
4. Видит клиентскую панель.
5. Подключает Meta Ads / Google Ads / другую платформу.
6. Видит доступные рекламные кабинеты.
7. Выбирает нужные кабинеты.
8. Подключает их к сервису.
9. Копирует / генерирует MCP URL.
10. Вставляет MCP URL в Claude / Codex.
11. Начинает пользоваться через AI.

## 2. Главный продуктовый принцип

Нужно разделить систему на 2 части:

- клиентская панель;
- админская / операторская панель.

Клиент не должен видеть технические ошибки вроде:

- `credentials missing`;
- `env missing`;
- `app_secret missing`;
- `developer_token missing`;
- raw JSON;
- stack trace;
- provider raw error;
- внутренние названия переменных окружения.

Клиент должен видеть понятные статусы:

- Доступ открыт.
- Платформа доступна для подключения.
- Платформа временно настраивается.
- Требуется повторное подключение.
- Выберите рекламные кабинеты.
- Подключение завершено.
- Обратитесь к менеджеру AdForge.

Техническая информация должна быть доступна только в admin/operator панели.

## 3. Язык интерфейса

На текущем этапе весь сайт и dashboard нужно перевести на русский язык. Первые клиенты будут русскоязычные, поэтому клиентский UI должен быть полностью на русском:

- экран входа;
- регистрация;
- профиль;
- onboarding;
- карточки платформ;
- ошибки;
- подсказки;
- диагностика для клиента;
- MCP setup;
- empty states;
- кнопки;
- статусы;
- предупреждения preview-only.

Английский можно оставить только:

- в технических docs;
- в API/tool names;
- в MCP protocol;
- в примерах для разработчиков;
- в скрытых admin/technical details, если пока нет времени переводить всё.

## 4. Новый путь клиента

### Шаг 1. Регистрация

Пользователь открывает сайт и видит:

- Войти;
- Зарегистрироваться;
- короткое объяснение, что такое AdForge MCP.

Регистрация на первом этапе только по email.

Поля:

- email;
- имя;
- пароль;
- повтор пароля.

Можно предусмотреть email magic link на будущее, но для beta можно начать с email + password, если это быстрее и безопаснее реализовать.

### Шаг 2. Вход

Пользователь входит по:

- email;
- password.

Beta access code можно временно оставить как дополнительный ограничитель доступа к beta, но в клиентском интерфейсе его нужно называть “код доступа”, а не “token”.

Лучший beta-вариант: регистрация доступна только по invite/access code. Пользователь вводит access code один раз при регистрации, затем входит по email/password.

### Шаг 3. Клиентская панель

После входа пользователь видит:

- приветствие;
- onboarding checklist;
- подключенные платформы;
- состояние MCP;
- кнопку “Скопировать MCP URL”;
- кнопку “Подключить платформу”.

Основные разделы клиентской панели:

- Начало работы;
- Подключения;
- MCP-подключение;
- Диагностика;
- Профиль.

### Шаг 4. Подключение платформы

Пользователь выбирает:

- Meta Ads;
- Google Ads;
- TikTok Ads;
- Yandex Direct.

Если платформа доступна, пользователь видит кнопку “Подключить”, проходит OAuth, возвращается в dashboard, выбирает рекламные кабинеты и сохраняет подключение.

Если платформа не настроена на стороне сервера, клиент видит “Платформа временно настраивается”, а не техническое `credentials missing`.

### Шаг 5. MCP setup

Пользователь видит:

- MCP URL;
- кнопку “Скопировать”;
- краткую инструкцию для Codex;
- краткую инструкцию для Claude.

На следующем этапе лучше перейти от общего beta token к user-specific API token.

### Шаг 6. Профиль пользователя

В профиле пользователь должен видеть:

- имя;
- email;
- статус аккаунта;
- роль;
- workspace / организацию;
- дату регистрации;
- подключенные платформы;
- кнопку “Изменить имя”;
- кнопку “Сменить пароль”;
- кнопку “Выйти”;
- кнопку “Сменить аккаунт”, если у пользователя несколько workspace / организаций.

Также можно предусмотреть:

- “Сгенерировать новый MCP access token”;
- “Отозвать текущий MCP access token”;
- “Последний вход”;
- “Активные сессии”.

## 5. Админская панель

Нужна отдельная admin/operator панель. Туда должен иметь доступ только пользователь с ролью `admin` или `operator`.

Админка нужна, чтобы владелец сервиса мог:

- видеть всех пользователей;
- включать пользователя;
- отключать пользователя;
- менять роль;
- видеть статус пользователя;
- видеть дату регистрации;
- видеть последний вход;
- видеть подключенные платформы;
- видеть выбранные рекламные кабинеты;
- видеть OAuth status;
- видеть ошибки подключений;
- видеть diagnostics;
- видеть platform credentials readiness;
- видеть preview-only status;
- смотреть audit log важных действий.

Даже в админке секреты должны быть hidden/redacted/present-or-missing и никогда не показываться raw.

Минимальные роли:

- `user/client` — подключает свои рекламные кабинеты, видит свои подключения и MCP setup;
- `admin` — видит пользователей, управляет статусом/ролями, смотрит диагностику;
- `operator/support` — опционально, видит статусы и помогает с подключением без критичных настроек.

Для beta можно начать с `user` + `admin`.

## 6. База данных

ClickHouse не использовать как основную базу пользователей и авторизации.

ClickHouse подходит для:

- больших объемов рекламных метрик;
- исторических срезов;
- логов;
- аналитики;
- отчетности;
- агрегированных данных.

ClickHouse не подходит как operational DB для:

- пользователей;
- сессий;
- ролей;
- OAuth state;
- подключений;
- прав доступа;
- настроек аккаунта;
- транзакционных изменений.

Рекомендация:

- для beta быстро и просто — SQLite с normal abstraction layer;
- если хотим сразу ближе к production — PostgreSQL;
- для production — PostgreSQL как основная база, ClickHouse позже как аналитическое хранилище.

Лучший вариант: сделать data access layer так, чтобы сначала можно было использовать SQLite/PostgreSQL. Для live beta лучше выбрать PostgreSQL, если на VPS можно быстро поднять и обслуживать.

## 7. Предлагаемая схема данных

Минимальная схема:

- `users`: id, email, password_hash, name, status, role, created_at, updated_at, last_login_at, deleted_at.
- `workspaces`: id, name, status, created_at, updated_at.
- `workspace_members`: id, workspace_id, user_id, role, created_at.
- `user_sessions`: id, user_id, session_token_hash, created_at, expires_at, revoked_at, user_agent, ip_hash.
- `mcp_access_tokens`: id, user_id, workspace_id, token_hash, name, status, created_at, last_used_at, revoked_at.
- `platform_connections`: id, workspace_id, user_id, platform, status, created_at, updated_at, last_success_at, last_error_code, last_error_message redacted.
- `selected_ad_accounts`: id, connection_id, platform, account_id, account_name, status, created_at, updated_at.
- `oauth_states`: id, workspace_id, user_id, provider, state_hash, status, created_at, expires_at, used_at.
- `audit_events`: id, actor_user_id, workspace_id, event_type, entity_type, entity_id, metadata_json redacted, created_at.
- `provider_credentials_status`: platform, configured, last_checked_at, status_message redacted.

На beta можно упростить и сделать один workspace на пользователя, но лучше сразу заложить workspace.

Сами `app_secret` / `client_secret` / `developer_token` в базе на beta этапе не хранить.

## 8. Auth и безопасность

Нужно реализовать:

- password hashing через надежный алгоритм;
- session cookies с HttpOnly, Secure, SameSite;
- CSRF protection, если используются cookie-based sessions;
- rate limiting на login/register;
- защита от brute force;
- не выводить raw errors;
- не логировать пароли;
- не логировать tokens;
- не хранить raw MCP tokens;
- не показывать secrets в frontend;
- не отдавать admin endpoints обычным users;
- disabled user не должен иметь доступ;
- logout должен инвалидировать session;
- admin actions должны попадать в audit log.

## 9. Связь текущего beta token и новой auth

Сейчас beta token защищает dashboard/API/MCP. Нельзя просто удалить его, пока нет нормальной замены.

Переходный план:

- Этап A: оставить beta token, но в UI назвать его “код доступа”.
- Этап B: добавить регистрацию по email + password, а access code использовать как invite code при регистрации.
- Этап C: для MCP endpoint перейти от общего beta token к user-specific MCP access token.
- Этап D: общий beta token оставить только для internal/admin/bootstrap или полностью убрать.

## 10. Клиентский интерфейс

Весь клиентский UI на русском.

Регистрация:

- Создать аккаунт;
- Введите email;
- Введите имя;
- Придумайте пароль;
- Повторите пароль;
- Введите код доступа;
- Зарегистрироваться;
- Уже есть аккаунт? Войти.

Вход:

- Вход в AdForge MCP;
- Email;
- Пароль;
- Войти;
- Нет аккаунта? Зарегистрироваться;
- Забыли пароль? Напишите менеджеру AdForge.

Для beta можно не делать password reset, если не успеваем. Нужно написать, что восстановление через менеджера.

Начало работы checklist:

- Аккаунт создан.
- Подключите рекламную платформу.
- Выберите рекламные кабинеты.
- Скопируйте MCP URL.
- Добавьте MCP в Codex / Claude.
- Задайте первый вопрос AI.

Подключения:

- Meta Ads;
- Google Ads;
- TikTok Ads;
- Yandex Direct.

Статусы:

- Доступно для подключения;
- Платформа настраивается;
- Подключено;
- Требуется повторное подключение;
- Выберите рекламные кабинеты;
- Ошибка подключения;
- Ограниченная beta-поддержка.

MCP Setup:

- Подключение к AI-клиенту;
- MCP URL;
- Скопировать URL;
- Используйте этот адрес в Codex или Claude;
- Для авторизации используйте ваш MCP access token;
- Во время beta изменения в рекламных кабинетах не применяются — доступен только preview.

Профиль:

- Имя;
- Email;
- Роль;
- Статус;
- Организация;
- Изменить имя;
- Сменить пароль;
- Сгенерировать новый MCP token;
- Выйти;
- Сменить аккаунт.

## 11. Админский интерфейс

Админский UI тоже на русском.

Разделы:

- Пользователи;
- Организации / workspace;
- Подключения;
- Диагностика;
- OAuth readiness;
- Audit log;
- System status.

Пользователи:

- email;
- имя;
- роль;
- статус;
- дата регистрации;
- последний вход;
- количество подключенных платформ;
- действия.

Действия:

- открыть пользователя;
- включить;
- отключить;
- сменить роль;
- сбросить MCP token;
- посмотреть audit events.

OAuth readiness показывает Meta/Google/TikTok/Yandex как “настроено / не настроено” без показа секретов.

System status показывает web service, MCP status, preview-only, live writes disabled, database status, storage status.

## 12. Этапы реализации

Не делать всё одним коммитом.

### Этап 1. Русификация и UX cleanup текущего beta dashboard

Цель:

- весь клиентский UI на русском;
- beta token переименовать в “код доступа”;
- убрать технические ошибки из клиентского UI;
- добавить нормальные клиентские статусы;
- спрятать technical details в admin/technical section;
- не менять backend auth.

Это безопасный первый шаг.

### Этап 2. Проектирование базы и auth architecture

Выбрать DB, migration tool, описать users/sessions/workspaces/connections, не ломать текущий connection store.

### Этап 3. Добавить базу данных

Добавить DB connection, migrations, таблицы users/sessions/workspaces/audit_events, health check базы. Пока не переносить OAuth connections, если рискованно.

### Этап 4. Регистрация и вход по email

Регистрация, вход, logout, password hash, session cookie, protected dashboard, disabled user check, beta access code как invite code при регистрации.

### Этап 5. Профиль пользователя

Экран профиля, изменить имя, сменить пароль, выйти, role/status/workspace, подготовить user-specific MCP token UI.

### Этап 6. Админская панель MVP

Admin route, список пользователей, карточка пользователя, включить/отключить, сменить роль, OAuth readiness, diagnostics, audit events.

### Этап 7. User-specific MCP tokens

Пользователь генерирует свой MCP token, raw token хранится только на момент выдачи, в базе только hash. MCP endpoint принимает user-specific token, общий beta token временно остается fallback/internal.

### Этап 8. Миграция connections в DB

Перенести connections из file storage в DB или сделать dual-read/write migration, связать с workspace/user, сохранить безопасность OAuth tokens, сделать backup перед миграцией.

### Этап 9. OAuth connections per workspace

Подключение Meta/Google привязано к workspace, пользователь видит только свои подключения, admin видит все, account selection сохраняется в DB.

### Этап 10. Production UX/design pass

После стабилизации логики передать дизайн другой AI/дизайнеру, сделать финальный внешний вид, branding, адаптив и polish.

## 13. Что нельзя делать

Нельзя:

- ломать hosted MCP;
- отключать preview-only;
- включать live writes;
- показывать secrets;
- хранить raw MCP tokens;
- использовать ClickHouse как основную auth DB;
- переносить legacy compromised Meta secrets;
- делать регистрацию без rate limiting;
- делать admin endpoints без role checks;
- делать hard reset live repo;
- трогать `connections.json` без backup/migration plan;
- удалять beta token auth до готовой замены;
- коммитить env/secrets/logs/backups.

## 14. Safe staged implementation plan после анализа текущей архитектуры

Текущая архитектура:

- Web dashboard: статический shell `src/ad_mcp/web/static/index.html`, `app.js`, `app.css`.
- Backend API: Python web app обслуживает `/api/*`, `/health`, `/ready`, OAuth callbacks и static assets.
- Current auth: общий bearer token из `AD_MCP_WEB_API_TOKEN`; в UI он был назван beta token, но backend пока оставляем без изменений.
- Connection storage: file store `tokens/connections.json` локально и `/var/lib/adforge-mcp/connections.json` на VPS.
- OAuth flow: `/api/hosted/oauth/<provider>/authorize-url`, callback, pending selection, select/disconnect.
- MCP auth: hosted MCP endpoint `/mcp` тоже использует bearer token.
- Diagnostics: `/api/diagnostics`, `/api/diagnostics/security`, `/api/diagnostics/mcp`, `/api/beta/capabilities`.
- Deploy/env docs: env хранит provider credentials, storage path, public MCP URL, preview-only и beta access token.

Рекомендованная beta DB:

- Для ближайшего beta-этапа: SQLite допустим только для локальной разработки и простого прототипа auth.
- Для live beta на VPS: PostgreSQL предпочтительнее, потому что нужны пользователи, роли, sessions, audit log и будущие workspace.
- ClickHouse не использовать для users/auth; оставить на будущий analytics/history этап.

Безопасные этапы:

1. Frontend-only русификация и UX cleanup: оставить backend token auth, но назвать его “код доступа”, спрятать technical provider errors из клиентских карточек, перевести onboarding.
2. Auth/schema design doc: зафиксировать PostgreSQL-first schema, migration tool и совместимость с текущим file store.
3. DB foundation без миграции OAuth tokens: подключение DB, migrations, health check, пустые таблицы users/workspaces/sessions/audit.
4. Email/password auth behind feature flag: регистрация по invite code, login/logout, HttpOnly cookie sessions, rate limit.
5. Client profile + user-specific MCP token UI: raw token показывать один раз, хранить hash.
6. Admin MVP: role checks, users list, OAuth readiness, redacted diagnostics.
7. MCP token migration: принимать user-specific MCP tokens, общий beta token оставить fallback/internal.
8. Connections DB migration: dual-read/write, backup, rollback plan.

Главные риски:

- сломать текущий hosted MCP bearer auth до появления user-specific tokens;
- смешать client UX и operator diagnostics;
- случайно показать env/provider secrets в UI или logs;
- мигрировать `connections.json` без backup и rollback;
- выбрать ClickHouse для operational auth data;
- сделать регистрацию без rate limiting/session hardening.

Первый безопасный PR/commit:

- создать этот roadmap;
- перевести текущий dashboard на русский;
- заменить “beta token” на “код доступа” только в UI;
- оставить `AD_MCP_WEB_API_TOKEN` и Authorization backend contract без изменений;
- скрыть provider `last_error` и env naming из client-facing connection cards;
- оставить raw diagnostics только в свернутом technical block для оператора.

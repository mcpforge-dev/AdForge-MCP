# Восстановление UI/UX V1 поверх HolyMedia MCP V2

## Основание

Source of truth для пользовательского поведения:

- требования владельца из документа «Правки по сайту mcp — скорректировано»;
- исторический V1 commit `c700fb7` (`src/ad_mcp/web/static/*`);
- findings Stage 1 в `STAGE_1_FULL_UX_UI_FUNCTIONAL_AUDIT_RU.md`.

Backend V2, PostgreSQL, Redis, Worker, MCP, OAuth applications, callback URL, provider credentials, connections и реальные account IDs не откатывались.

## Что восстановлено

- единая V1-подобная публичная страница и CTA без технической терминологии;
- вход и регистрация как основные auth-сценарии, восстановление пароля по отдельной ссылке;
- прямой `/auth?mode=signup`;
- клиентская навигация без Workspace, RBAC и внутренних analytics-разделов;
- email-профиль в header и footer с юридическими ссылками во всех разделах;
- понятный dashboard: подключения, выбранные кабинеты, AI-клиент и отчёты;
- provider connection flow с OAuth, reconnect, discovery, статусом и подтверждением отключения;
- выбор кабинетов с «Выбрать все», «Снять все», отдельным сохранением и feedback;
- Google Search Console отображается как «В разработке» и не предлагает OAuth;
- V1 client-first MCP onboarding для Codex, Claude и ChatGPT;
- безопасное создание, однократный показ, обновление и отзыв ключей;
- отчёты с рабочими периодами 7/14/30 дней;
- профиль: имя, email, фото до 2 МБ, число подключённых платформ и смена пароля;
- полные страницы Privacy и Terms из финального V1;
- desktop/mobile layouts и доступные modal/form/navigation states.

## Что осталось V2-only

- server-side sessions, CSRF, Argon2id и transitional PBKDF2 login;
- PostgreSQL data model и tenant isolation;
- AES-256-GCM credential vault;
- service-token digests, scopes и account restrictions;
- MCP preview/confirmation/commit/audit boundary;
- billing/entitlements foundation (тарифы пока показаны как недоступный будущий раздел);
- analytics/admin foundations остаются backend/internal и не засоряют клиентскую навигацию.

## Старые ошибки, которые не возвращались

- plaintext/local storage credentials;
- действия без подтверждения;
- повторный показ полного service token;
- мгновенный account toggle без сохранения и обратной связи;
- OAuth callback, отклоняющий легитимный Google `scope` query;
- зависимость static assets от общего Nginx request burst limit;
- технические статусы, IDs, scopes и role/workspace terminology в клиентском UI.

## Проверка

- local format/lint/typecheck/build: PASS;
- API unit: 65 PASS, integration suite выполняется в CI с PostgreSQL/Redis;
- standalone Playwright desktop/mobile: PASS;
- axe desktop/mobile, public/private customer surfaces: 0 violations;
- screenshots: landing, registration, dashboard, connections, MCP, reports, profile и mobile connections;
- provider operations в browser tests ограничены синтетическими CI fixtures; production provider writes не выполняются.

Финальные CI, production image, deploy и provider/account integrity evidence дополняются после release pipeline.

# HolyMedia MCP V2 — Stage 1: независимый UX/UI/functional audit

Дата проверки: 2026-08-24  
Цель: `https://mcp.holymedia.kz`  
Production UI во время аудита не изменялся и не деплоился.

## Метод и границы evidence

Проверка проведена последовательно: `holymedia-design-audit` → production walkthrough → standalone headless Playwright → `@axe-core/playwright` → human copy review. Встроенный browser MCP намеренно не использовался из-за нестабильности desktop-клиента; браузер запускался отдельным процессом Playwright.

Production проверен на ширинах 1440, 1280, 390 и 375 px. Публичные сценарии прогнаны дважды. Закрытые страницы дополнительно отрисованы точным текущим frontend-кодом с локальными sanitized mock-ответами, без production credentials и без provider writes. Это позволило проверить layout и axe, но не заменяет authenticated production E2E: доступных audit credentials не обнаружено, а создавать production-пользователя ради аудита запрещено. OAuth, disconnect, account mutation, token rotation/revoke и provider writes не выполнялись.

Исторический reference: V1 commit `c700fb7`, прежде всего `src/ad_mcp/web/static/index.html`, `app.css`, `app.js`.

## Findings

## [F01] Rate limit ломает загрузку CSS/JavaScript production-интерфейса

**Экран:** весь публичный Web, особенно auth на mobile.  
**Severity:** P0  
**Тип:** `Functional`, `UI`, `Mobile`, `Accessibility`  
**Что сейчас:** обычный браузерный burst периодически получает `503` на Next.js chunks, CSS и Manrope; вместо asset приходит HTML error response.  
**Что плохо:** страница оказывается полностью неоформленной, hydration не происходит, кнопки и auth-сценарии перестают работать.  
**Почему это проблема:** пользователь заблокирован ещё до входа. Два независимых прогона дали 217 и 237 browser/network events; Nginx inspection подтвердил общий `limit_req` на web-location, куда попадают static assets.  
**Evidence:** production Playwright, screenshots, console/network inspection, read-only Nginx inspection.  
**V1 comparison:** V1 не дробил интерфейс на такой asset burst и не проявлял этот отказ в проверенном production contract.  
**Направление исправления:** отделить static assets от пользовательского request rate limit и оставить лимит на чувствительных API/auth endpoints.

## [F02] Ссылка регистрации открывает форму входа

**Экран:** homepage → `/auth?mode=signup`.  
**Severity:** P1  
**Тип:** `Functional`, `UX`  
**Что сейчас:** CTA ведёт на signup URL, но активной остаётся вкладка «Войти», поле имени отсутствует.  
**Что плохо:** обещанное действие и результат расходятся.  
**Почему это проблема:** новый пользователь может решить, что регистрация закрыта или ссылка сломана. Ошибка повторилась на всех четырёх viewport.  
**Evidence:** production Playwright, screenshot, source review.  
**V1 comparison:** V1 открывал явный registration state.  
**Направление исправления:** синхронизировать auth mode с query и проверить прямые ссылки для login/signup/reset.

## [F03] Защита закрытых страниц зависит от успешно загруженного JavaScript

**Экран:** `/dashboard`.  
**Severity:** P1  
**Тип:** `Functional`, `UX`  
**Что сейчас:** anonymous request остаётся на `/dashboard`; redirect выполняется клиентом после API-запроса. При F01 остаётся пустой shell без объяснения.  
**Что плохо:** route не даёт предсказуемого server-side результата.  
**Почему это проблема:** пользователь видит сломанную страницу вместо входа, а поведение auth зависит от hydration.  
**Evidence:** production Playwright, source review.  
**V1 comparison:** V1 auth shell явно управлял доступом до показа приложения.  
**Направление исправления:** обеспечить server/middleware guard или надёжный auth fallback до client hydration.

## [F04] Выбранный период отчёта игнорируется

**Экран:** Reports.  
**Severity:** P1  
**Тип:** `Functional`, `UX`  
**Что сейчас:** UI предлагает 7/14/30 дней, но download handler всегда отправляет диапазон `lastSevenDays()`.  
**Что плохо:** интерфейс подтверждает выбор, который не влияет на результат.  
**Почему это проблема:** клиент получает фактически неверный отчёт и может принять бизнес-решение по неправильному периоду.  
**Evidence:** Playwright-oriented source audit, current implementation trace.  
**V1 comparison:** V1 period selector участвовал в generation flow.  
**Направление исправления:** строить request range из выбранного значения и покрыть все варианты E2E.

## [F05] Connections не помещается на мобильном экране

**Экран:** Connections, 375 px.  
**Severity:** P1  
**Тип:** `Mobile`, `UI`, `Functional`, `UX`  
**Что сейчас:** при viewport 375 px документ имеет `scrollWidth=693`; account/status/actions уходят вправо и обрезаются.  
**Что плохо:** пользователь не видит часть кабинетов и действий без неочевидного горизонтального скролла.  
**Почему это проблема:** основной продуктовый flow подключения кабинета фактически непригоден на телефоне.  
**Evidence:** screenshot, Playwright layout measurement.  
**V1 comparison:** V1 применял отдельную mobile-композицию списков и modal account selector.  
**Направление исправления:** перестроить provider/account rows в устойчивый mobile layout без document-level overflow.

## [F06] Disconnect выполняется без подтверждения

**Экран:** Connections.  
**Severity:** P1  
**Тип:** `Functional`, `UX`  
**Что сейчас:** действие сразу вызывает DELETE connection.  
**Что плохо:** нет confirmation с ясным последствием и возможности отмены.  
**Почему это проблема:** случайный клик может отключить рабочее OAuth-подключение и потребовать reconnect.  
**Evidence:** source/interaction review.  
**V1 comparison:** V1 опасные connection-действия были отделены от обычного просмотра.  
**Направление исправления:** добавить подтверждение с provider/account context и pending state.

## [F07] Rotate и revoke service token не имеют защитного шага

**Экран:** MCP / Service tokens.  
**Severity:** P1  
**Тип:** `Functional`, `UX`  
**Что сейчас:** revoke/rotate уходят в API немедленно.  
**Что плохо:** destructive security action визуально выглядит как обычная команда.  
**Почему это проблема:** действующие MCP clients могут мгновенно потерять доступ.  
**Evidence:** source/interaction review.  
**V1 comparison:** V1 делал момент выдачи и замены ключа более явным.  
**Направление исправления:** обязательное confirmation, последствия, pending/success/error и безопасное повторное отображение setup guidance.

## [F08] Одноразовый secret невозможно удобно скопировать

**Экран:** MCP / создание service token.  
**Severity:** P1  
**Тип:** `UX`, `Functional`  
**Что сейчас:** plaintext показывается один раз в textarea, рядом есть только «Скрыть».  
**Что плохо:** отсутствует явная команда copy и подтверждение копирования.  
**Почему это проблема:** одноразовое значение легко потерять; повторно получить его по security model нельзя.  
**Evidence:** fixture screenshot, source review.  
**V1 comparison:** V1 имел отдельные copy token и copy Authorization actions.  
**Направление исправления:** добавить безопасный copy control и ясное одноразовое предупреждение, не меняя token model.

## [F09] MCP onboarding стал техническим и хуже V1

**Экран:** MCP.  
**Severity:** P1  
**Тип:** `UX`, `Copy`, `Developer UI`  
**Что сейчас:** основной flow построен вокруг «service token», scopes, account allowlist, write policy и confirmation.  
**Что плохо:** клиенту показывают архитектурные сущности раньше задачи «подключить ChatGPT/Claude/Codex».  
**Почему это проблема:** пользователь должен самостоятельно перевести backend-модель в понятные действия.  
**Evidence:** screenshot, copy review, V1 comparison.  
**V1 comparison:** V1 давал client-specific вкладки, точные инструкции, URL и copy actions.  
**Направление исправления:** вернуть пошаговый client-first setup, а advanced security settings оставить вторичным уровнем.

## [F10] Dashboard выглядит как marketing landing внутри кабинета

**Экран:** Dashboard overview.  
**Severity:** P1  
**Тип:** `UX`, `UI`, `AI-generated`  
**Что сейчас:** первый блок снова продаёт «Вся ваша реклама — в одном AI-чате», затем идут симметричные stat cards и onboarding-карточки.  
**Что плохо:** после входа нет сильного operational focus; экран повторяет обещание продукта вместо текущего состояния пользователя.  
**Почему это проблема:** connected user медленнее находит кабинеты, MCP и отчёты. Структура «hero + четыре cards + три steps» выглядит шаблонно сгенерированной.  
**Evidence:** desktop/mobile screenshots, design skill review.  
**V1 comparison:** V1 «Начало работы» было компактнее и ближе к конкретным действиям.  
**Направление исправления:** сделать overview state-aware и поставить реальные next actions выше marketing copy.

## [F11] Mobile navigation скрывает половину продукта

**Экран:** dashboard navigation, 390/375 px.  
**Severity:** P1  
**Тип:** `Mobile`, `UX`, `Functional`  
**Что сейчас:** видны только первые вкладки; Workspace, Billing, Analytics и Profile уходят за край без menu или заметного affordance.  
**Что плохо:** важные разделы выглядят отсутствующими.  
**Почему это проблема:** пользователь не обязан догадаться о горизонтальном скролле tab strip.  
**Evidence:** mobile screenshot, Playwright traversal.  
**V1 comparison:** V1 mobile header давал более явный доступ к navigation/profile.  
**Направление исправления:** использовать mobile navigation pattern с полным перечнем и стабильными touch targets.

## [F12] Provider internals выведены в клиентский интерфейс

**Экран:** Connections.  
**Severity:** P1  
**Тип:** `UX`, `Copy`, `Developer UI`  
**Что сейчас:** показаны `CONNECTED`, `DEGRADED`, `AVAILABLE`, `PREVIEW`, external IDs и `pages_read_engagement`.  
**Что плохо:** enum/scopes не объясняют клиенту, что работает и что делать.  
**Почему это проблема:** техническая диагностика заменяет пользовательский статус и remediation.  
**Evidence:** screenshot, copy/source review.  
**V1 comparison:** V1 чаще говорил языком подключения и кабинетов.  
**Направление исправления:** отображать понятное состояние и действие; raw details прятать в support diagnostics.

## [F13] Внутренняя Meta-заявка захватила основной connection flow

**Экран:** Connections / Meta.  
**Severity:** P1  
**Тип:** `UX`, `Copy`, `Developer UI`  
**Что сейчас:** крупная форма просит Company, ad account ID, Business ID, Page ID и Instagram ID прямо на странице обычного OAuth onboarding.  
**Что плохо:** ручной support-сценарий выглядит обязательным и требует терминов, которые обычный клиент может не знать.  
**Почему это проблема:** основной self-service OAuth flow теряет приоритет и создаёт впечатление, что подключение невозможно без специалиста.  
**Evidence:** screenshot, source/copy review.  
**V1 comparison:** V1 позволял пользователю самостоятельно пройти OAuth и выбрать доступные кабинеты.  
**Направление исправления:** оставить заявку вторичным support path и не смешивать её с обязательным onboarding.

## [F14] Billing и Analytics выглядят как внутренние панели разработчика

**Экран:** Billing, Analytics.  
**Severity:** P1  
**Тип:** `UX`, `Copy`, `Developer UI`  
**Что сейчас:** пользователь видит legacy entitlement, payment gateway, Entitlements, Internal plan, Product events, Usage records и event names.  
**Что плохо:** продукт показывает незавершённую domain architecture вместо тарифа и понятного использования.  
**Почему это проблема:** экран снижает доверие и заставляет разбираться в миграционных/серверных понятиях.  
**Evidence:** screenshots, copy review.  
**V1 comparison:** этих внутренних V2-сущностей в клиентском V1 не было.  
**Направление исправления:** отделить customer billing от admin diagnostics; internal-only данные не выводить обычному пользователю.

## [F15] Вкладка «AI-клиент» может открывать пустой экран

**Экран:** dashboard navigation / MCP.  
**Severity:** P1  
**Тип:** `Functional`, `UX`  
**Что сейчас:** tab виден всем ролям, но section рендерится только для OWNER/ADMIN. MEMBER/VIEWER получает пустой content area.  
**Что плохо:** navigation обещает доступную функцию, но не показывает ни контента, ни причины ограничения.  
**Почему это проблема:** это прямой UX-тупик и role-dependent functional regression.  
**Evidence:** source conditional review.  
**V1 comparison:** V1 не показывал пустой permission-dependent раздел.  
**Направление исправления:** скрывать недоступную вкладку либо показывать понятный read-only/access state.

## [F16] Выбор кабинета сохраняется мгновенно без feedback и rollback

**Экран:** Connections / account selector.  
**Severity:** P1  
**Тип:** `Functional`, `UX`  
**Что сейчас:** checkbox сразу отправляет PATCH; нет per-row pending, success, error rollback или итогового «Сохранено».  
**Что плохо:** пользователь не понимает, применилось ли действие, и может быстро отправить конфликтующие изменения.  
**Почему это проблема:** selected account scope влияет на MCP и отчёты, но интерфейс не подтверждает фактическое состояние.  
**Evidence:** source/interaction review.  
**V1 comparison:** V1 имел более явный selection/save flow.  
**Направление исправления:** либо staged save, либо надёжный optimistic state с pending, rollback и подтверждением.

## [F17] Auth tabs имеют некорректную ARIA-структуру

**Экран:** login/register/reset.  
**Severity:** P2  
**Тип:** `Accessibility`  
**Что сейчас:** элемент с `role=tablist` содержит обычные buttons без требуемых `role=tab`, `aria-selected` и tabpanel relationship.  
**Что плохо:** заявленная семантика не соответствует интерактивной модели.  
**Почему это проблема:** screen reader получает неполную/ошибочную навигацию.  
**Evidence:** axe critical `aria-required-children`, desktop/mobile.  
**V1 comparison:** не применимо.  
**Направление исправления:** реализовать полноценный tabs pattern либо убрать ложный ARIA role.

## [F18] Главный signup CTA не проходит contrast

**Экран:** homepage.  
**Severity:** P2  
**Тип:** `Accessibility`, `UI`  
**Что сейчас:** текст CTA имеет contrast около 1.17:1 (`#a4adbb` на `#7c9aff`).  
**Что плохо:** надпись почти сливается с кнопкой.  
**Почему это проблема:** основное действие плохо читается, особенно при сниженной контрастной чувствительности.  
**Evidence:** axe serious `color-contrast` на 1440/1280.  
**V1 comparison:** V1 CTA имел более контрастную подачу.  
**Направление исправления:** подобрать пару foreground/background с WCAG AA и проверить все button states.

## [F19] Select роли приглашения не имеет accessible name

**Экран:** Workspace.  
**Severity:** P2  
**Тип:** `Accessibility`  
**Что сейчас:** `select[name=role]` не связан с label/aria-label.  
**Что плохо:** назначение control определяется только визуальным соседством.  
**Почему это проблема:** screen reader не объясняет, что именно выбирается.  
**Evidence:** axe critical `select-name`.  
**V1 comparison:** новая V2-функция.  
**Направление исправления:** добавить корректный visible label и programmatic association.

## [F20] Слишком много touch targets меньше 44 px

**Экран:** dashboard, Connections, mobile.  
**Severity:** P2  
**Тип:** `Accessibility`, `Mobile`, `UI`  
**Что сейчас:** измерено 13 маленьких targets на mobile dashboard и 26 на mobile Connections; desktop screens также содержат 10–28 компактных controls.  
**Что плохо:** tabs, icon/actions и мелкие buttons трудно нажимать.  
**Почему это проблема:** растёт число ошибочных нажатий и снижается моторная доступность.  
**Evidence:** Playwright geometry audit, manual screenshot review.  
**V1 comparison:** часть V1 mobile controls имела более крупные hit areas.  
**Направление исправления:** увеличить реальную interactive area без раздувания визуального шума.

## [F21] Три равноправные auth-вкладки перегружают mobile

**Экран:** auth, 375 px.  
**Severity:** P2  
**Тип:** `UX`, `UI`, `Mobile`  
**Что сейчас:** «Войти», «Регистрация», «Сбросить пароль» конкурируют в одной строке; последняя надпись переносится.  
**Что плохо:** primary и recovery flows визуально равнозначны, card становится тесной.  
**Почему это проблема:** пользователь хуже считывает основной сценарий, а mobile-композиция выглядит сломанной.  
**Evidence:** production screenshot, design review.  
**V1 comparison:** V1 разводил вход и recovery яснее.  
**Направление исправления:** оставить login/register основными, recovery оформить контекстной ссылкой/отдельным состоянием.

## [F22] CTA и buttons не имеют единой визуальной грамматики

**Экран:** homepage/auth/dashboard.  
**Severity:** P2  
**Тип:** `UI`, `Consistency`  
**Что сейчас:** часть primary actions выглядит как underlined link внутри кнопки, часть как filled button, часть как compact text action.  
**Что плохо:** одинаковая важность кодируется разными стилями.  
**Почему это проблема:** CTA hierarchy приходится угадывать.  
**Evidence:** screenshots, design skill review.  
**V1 comparison:** V1 button classes были более последовательны внутри одного flow.  
**Направление исправления:** определить ограниченный набор button/link variants и применять по семантике.

## [F23] Роли, workspace и статусы показаны без перевода в пользовательский смысл

**Экран:** overview, Workspace, Connections.  
**Severity:** P2  
**Тип:** `UX`, `Copy`, `Developer UI`  
**Что сейчас:** видны `OWNER`, slug/workspace terminology и raw provider status labels.  
**Что плохо:** внутренние enum становятся ключевыми visual signals.  
**Почему это проблема:** обычному клиенту нужны права и последствия, а не название backend-роли.  
**Evidence:** screenshots, copy review.  
**V1 comparison:** V1 меньше выставлял RBAC-модель наружу.  
**Направление исправления:** переводить внутреннее состояние в краткий customer-facing смысл, raw values оставить support/admin.

## [F24] Интерфейс переупакован в повторяющиеся карточки

**Экран:** dashboard, MCP, billing, reports.  
**Severity:** P2  
**Тип:** `UX`, `UI`, `AI-generated`  
**Что сейчас:** почти каждый фрагмент имеет отдельный rounded container, badge, icon/title/description и одинаковый rhythm.  
**Что плохо:** важные и второстепенные блоки выглядят равными, рабочая поверхность дробится.  
**Почему это проблема:** это типичный generic SaaS pattern: компоненты существуют ради симметрии, а не скорости выполнения задачи.  
**Evidence:** multi-screen screenshot review.  
**V1 comparison:** V1 был грубее визуально, но местами плотнее и прямее.  
**Направление исправления:** уменьшить число визуальных контейнеров и строить hierarchy содержанием, а не обводкой каждого блока.

## [F25] Нет массового выбора и ясного Save-момента для кабинетов

**Экран:** Connections / accounts.  
**Severity:** P2  
**Тип:** `UX`, `Functional`  
**Что сейчас:** accounts переключаются по одному; «Все»/select all и итоговое сохранение отсутствуют.  
**Что плохо:** при десятках кабинетов flow становится медленным и непредсказуемым.  
**Почему это проблема:** выбор кабинетов — центральная задача продукта, а не edge case.  
**Evidence:** source/screenshot review.  
**V1 comparison:** V1 account selector давал более явный bulk-selection flow.  
**Направление исправления:** вернуть понятный bulk control и подтверждённое сохранение с workspace scope.

## [F26] Ошибки показываются глобально и без пути исправления

**Экран:** dashboard sections.  
**Severity:** P2  
**Тип:** `UX`, `Functional`, `Copy`  
**Что сейчас:** многие ошибки сводятся к одному общему `role=alert` внизу страницы.  
**Что плохо:** сообщение отделено от сломанного действия, не всегда объясняет следующий шаг.  
**Почему это проблема:** пользователь не понимает, что именно не сохранилось и можно ли повторить.  
**Evidence:** source/state review.  
**V1 comparison:** V1 чаще имел локальные status/empty containers.  
**Направление исправления:** локализовать error state у действия и дать safe retry/remediation.

## [F27] Disabled actions не объясняют причину

**Экран:** Connections, reports, MCP.  
**Severity:** P2  
**Тип:** `UX`, `Functional`, `Accessibility`  
**Что сейчас:** read/report/action buttons могут быть disabled без видимого пояснения.  
**Что плохо:** control выглядит недоступным, но пользователь не знает, нужен ли account selection, permission или subscription.  
**Почему это проблема:** disabled state становится тупиком и плохо доступен для assistive technology.  
**Evidence:** source/manual review.  
**V1 comparison:** V1 empty/status copy чаще объяснял недоступность.  
**Направление исправления:** рядом показывать конкретную причину и ближайшее доступное действие.

## [F28] Reports смешивает внутреннюю терминологию и декоративный mock

**Экран:** Reports.  
**Severity:** P2  
**Тип:** `UI`, `Copy`, `AI-generated`, `Developer UI`  
**Что сейчас:** есть фразы про «server V2», workspace и billing entitlement, рядом декоративная англоязычная карточка «Monthly Ads Report».  
**Что плохо:** экран выглядит как шаблон/демо, а не как фактический генератор клиентского отчёта.  
**Почему это проблема:** декоративные KPI конкурируют с реальными controls и подрывают доверие к данным.  
**Evidence:** screenshot, copy review.  
**V1 comparison:** V1 показывал PDF/DOCX и более предметный report preview.  
**Направление исправления:** убрать внутреннюю механику и оставить реальный выбор данных, периода, формата и результата.

## [F29] Profile объясняет backend вместо управления профилем

**Экран:** Profile.  
**Severity:** P2  
**Тип:** `UX`, `Copy`, `Developer UI`  
**Что сейчас:** текст сообщает, что «Имя и пароль управляются безопасными V2 auth endpoints»; avatar/photo отсутствует.  
**Что плохо:** пользователю рассказывают способ реализации, а не доступные действия.  
**Почему это проблема:** профиль выглядит технической заглушкой и потерял узнаваемость V1.  
**Evidence:** screenshot, V1/source comparison.  
**V1 comparison:** V1 поддерживал nickname, avatar/photo и password UI.  
**Направление исправления:** вернуть полноценный customer profile поверх текущих безопасных API.

## [F30] Token list показывает scopes, но скрывает полезный lifecycle context

**Экран:** MCP / tokens.  
**Severity:** P2  
**Тип:** `UX`, `Copy`, `Developer UI`  
**Что сейчас:** акцент на `ads:read`, `reports:read`, provider enums и allowlist; expiry/last used не представлены достаточно заметно.  
**Что плохо:** клиент видит machine-readable permissions, но хуже понимает, какой ключ живой и где используется.  
**Почему это проблема:** управление доступом становится сложнее и опаснее.  
**Evidence:** fixture screenshot, source/data-model review.  
**V1 comparison:** V1 был проще и сильнее концентрировался на подключении клиента.  
**Направление исправления:** переводить scopes в понятные возможности и показывать status, expiry, last use и affected clients.

## [F31] Начальная загрузка маскируется нулевыми значениями

**Экран:** Dashboard.  
**Severity:** P2  
**Тип:** `UX`, `Functional`  
**Что сейчас:** до завершения API calls overview способен показать пустые/нулевые cards без явного skeleton/loading state.  
**Что плохо:** временное состояние выглядит как фактическое отсутствие подключений или данных.  
**Почему это проблема:** пользователь получает ложный сигнал и может начать повторное подключение.  
**Evidence:** source state review.  
**V1 comparison:** V1 имел явные loading/status сообщения в ключевых списках.  
**Направление исправления:** различать loading, empty, error и loaded-zero states.

## [F32] Русский интерфейс смешан с английскими enums и служебными eyebrow

**Экран:** Connections, Reports, Billing, Analytics.  
**Severity:** P2  
**Тип:** `Copy`, `Consistency`, `Developer UI`  
**Что сейчас:** `PROVIDERS`, `CONNECTED`, `PREVIEW`, `Entitlements`, `Usage records`, event names соседствуют с русским copy.  
**Что плохо:** язык интерфейса выглядит незавершённым и собранным из разных модулей.  
**Почему это проблема:** пользователь считывает продукт как developer build, а не готовый SaaS.  
**Evidence:** screenshots, full copy review.  
**V1 comparison:** V1 был лингвистически более цельным.  
**Направление исправления:** разделить customer copy и internal diagnostics, выровнять locale.

## [F33] Landing перегружен AI-SaaS обещаниями и повторениями

**Экран:** homepage.  
**Severity:** P2  
**Тип:** `Copy`, `UX`, `AI-generated`  
**Что сейчас:** много длинных объясняющих секций, повторяется обещание «один AI-чат», заявлено «настройка занимает один вечер» и перечислены возможности без чёткой product proof.  
**Что плохо:** copy звучит как сгенерированный pitch, а не спокойное объяснение продукта.  
**Почему это проблема:** первый экран не даёт быстрого ответа «что подключаю, что получаю и что делать сейчас».  
**Evidence:** production screenshot, hero/copy audit.  
**V1 comparison:** V1 был менее polished, но местами конкретнее в setup instructions.  
**Направление исправления:** сократить повторения и привязать обещания к реальному flow/доказательствам.

## [F34] DOCX generation продублирована в разных местах

**Экран:** Connections account rows и Reports.  
**Severity:** P2  
**Тип:** `UX`, `Consistency`, `Functional`  
**Что сейчас:** download/report action присутствует рядом с отдельными accounts и в самостоятельном Reports-разделе без ясного различия.  
**Что плохо:** одинаковая задача имеет две точки входа с разной композицией.  
**Почему это проблема:** пользователь не понимает, где canonical report flow и различается ли результат.  
**Evidence:** screenshot/source comparison.  
**V1 comparison:** V1 концентрировал форматы и параметры на reports screen.  
**Направление исправления:** определить один основной report flow, а row action сделать понятным shortcut с теми же параметрами.

## [F35] Возврат из OAuth не имеет явного контекстного результата

**Экран:** Connections после provider callback.  
**Severity:** P2  
**Тип:** `UX`, `Functional`  
**Что сейчас:** в текущем dashboard source не найдено явной обработки callback success/error query с фокусом на provider card; реальный OAuth намеренно не запускался.  
**Что плохо:** пользователь может вернуться на общий экран и не понять, завершилось ли подключение и где кабинеты.  
**Почему это проблема:** OAuth является главным onboarding flow, поэтому результат должен быть недвусмысленным.  
**Evidence:** source review; live callback не выполнялся из-за read-only scope аудита.  
**V1 comparison:** поздние V1 fixes сохраняли return-to-origin и status feedback.  
**Направление исправления:** подтвердить фактический callback contract и показывать provider-specific success/error/discovery state.

## [F36] Fake chat и hard-coded metrics выглядят как недоказанное демо

**Экран:** homepage hero.  
**Severity:** P3  
**Тип:** `UI`, `AI-generated`  
**Что сейчас:** декоративный chat показывает готовые рекламные цифры без маркировки примера.  
**Что плохо:** блок похож на типовой AI mock и может восприниматься как реальная аналитика/доказательство.  
**Почему это проблема:** доверие к data product требует ясного различия demo и факта.  
**Evidence:** production screenshot, design review.  
**V1 comparison:** V1 меньше опирался на декоративную симуляцию результата.  
**Направление исправления:** либо явно маркировать demo, либо показывать реальный продуктовый screen/evidence.

## [F37] Бренд сведен к маленькому синему квадрату

**Экран:** landing/header/auth.  
**Severity:** P3  
**Тип:** `UI`, `Consistency`  
**Что сейчас:** основной visual identifier — generic blue square и текстовое название.  
**Что плохо:** product identity слабо отличается от шаблонного dark SaaS.  
**Почему это проблема:** интерфейс труднее узнавать, особенно на auth/mobile.  
**Evidence:** screenshot review.  
**V1 comparison:** исторические logo/assets давали более конкретный product signal.  
**Направление исправления:** вернуть реальный бренд-asset и единое использование без изменения общей product hierarchy.

## [F38] Избыточные пустоты и повторяющийся footer растягивают рабочие страницы

**Экран:** dashboard sections.  
**Severity:** P3  
**Тип:** `UI`, `UX`  
**Что сейчас:** компактные настройки окружены крупными вертикальными gaps, footer повторяет product/support context на каждой вкладке.  
**Что плохо:** рабочая поверхность становится длиннее, чем требует задача.  
**Почему это проблема:** repeated-action SaaS должен быть плотным и сканируемым.  
**Evidence:** multi-screen screenshot review.  
**V1 comparison:** V1 был визуально менее аккуратным, но местами эффективнее использовал высоту.  
**Направление исправления:** уплотнить operational screens и оставить footer только там, где он действительно помогает.

## A. Топ-10 худших решений текущей версии

1. Rate limit на static assets, превращающий production UI в неоформленный и неинтерактивный HTML.
2. Mobile Connections с шириной 693 px при viewport 375 px.
3. Period selector, который всегда генерирует отчёт за 7 дней.
4. Signup CTA, открывающий login.
5. Client-only auth guard, оставляющий anonymous shell `/dashboard` при JS failure.
6. Internal billing/analytics architecture, выставленная обычному пользователю.
7. Raw provider scopes/statuses/IDs вместо понятного статуса и действия.
8. Destructive disconnect/rotate/revoke без confirmation.
9. MCP onboarding, потерявший V1 client-specific setup и copy actions.
10. Dashboard, который не адаптируется к уже подключённым providers и продолжает показывать marketing/onboarding как универсальный шаблон.

## B. UX-тупики

- Signup CTA приводит к форме входа.
- При asset `503` пользователь получает неоформленную страницу без recovery path.
- Anonymous `/dashboard` остаётся пустым shell вместо входа.
- Mobile navigation скрывает поздние вкладки без menu/hint.
- MEMBER/VIEWER может открыть пустой «AI-клиент».
- Disabled actions не объясняют недостающий permission/account/plan.
- Account checkbox не сообщает, сохранено ли изменение.
- OAuth return не имеет подтверждённого provider-specific feedback.
- Ошибка внизу страницы не связана с конкретным control.
- Одноразовый token можно скрыть, но нельзя явно скопировать.
- Reports принимает период, который не применяется.
- Два DOCX entry points не объясняют различие.
- Raw `DEGRADED`/scope не даёт понятного действия.
- Meta support form требует неизвестные IDs и выглядит обязательной.

## C. Functional problems

- Static asset `503` и hydration failure.
- Signup query не применяется.
- Client-only anonymous redirect.
- Report period hard-coded на семь дней.
- Mobile Connections overflow.
- Immediate disconnect/revoke/rotate.
- Blank permission-dependent MCP tab.
- Account autosave без pending/rollback.
- Нет bulk selection/save модели.
- Loading и loaded-empty не разделены.
- OAuth callback feedback не подтверждён в current screen implementation.
- Auth submit не имеет явной блокировки от double submit.

## D. Что выглядит AI-generated

- Dashboard pattern «marketing hero + stat cards + onboarding cards» после входа.
- Повсеместные одинаковые rounded cards с icon/title/description.
- Reports demo card «Monthly Ads Report» с декоративными KPI.
- Landing с повторяющимися обещаниями AI-чата и произвольным «один вечер».
- Fake chat с hard-coded цифрами без product evidence.

## E. Что выглядит developer UI

- `OWNER`, workspace slug и workspace terminology.
- `CONNECTED`, `DEGRADED`, `AVAILABLE`, `PREVIEW`.
- `pages_read_engagement` и provider external IDs.
- `service token`, `ads:read`, `reports:read`, allowlist и confirmation policy.
- `legacy entitlement`, `Internal plan`, `payment gateway`, `Entitlements`.
- `Product events`, `Usage records`, `mcp.setup_viewed`.
- «server V2» и «V2 auth endpoints».
- Meta Business/Page/Instagram identifiers в основной форме.

## F. Human copy problems

- «Откройте рабочее пространство HolyMedia» → требует внутреннего термина до объяснения пользовательской задачи.
- «Создайте защищённое рабочее пространство» → звучит как backend/security инструкция.
- «Только ваши workspace-данные» → смешивает языки и внутреннюю модель.
- «Разрешения: 2/3 · не хватает pages_read_engagement» → API scope вместо понятной причины и действия.
- «Последний ответ провайдера» → диагностический термин без customer value.
- «Доступ для AI-клиента и Гермеса» → смешивает пользовательский продукт и внутренний runtime.
- «Создайте service token» → англоязычная security-сущность поставлена раньше цели.
- «Ограничьте ключ конкретными аккаунтами» → требует понимания allowlist до базового setup.
- «Разрешить подтверждённые write-запросы» → сложная policy-фраза для обычного onboarding.
- «Изменения всё равно проходят через policy и confirmation» → прямое протекание архитектуры и смешение языков.
- «Текущие рабочие пространства продолжают работать на legacy entitlement» → миграционная деталь, не пользовательский тариф.
- «payment gateway подключается отдельно» → roadmap/implementation note в production UI.
- «Entitlements» → внутреннее название billing domain.
- «Служебная статистика без provider credentials» → security assurance сформулирован через backend boundary.
- «Product events», «Usage records», `mcp.setup_viewed` → telemetry vocabulary без пользовательского смысла.
- «Имя и пароль управляются безопасными V2 auth endpoints» → объясняет реализацию вместо profile actions.
- «Настройка занимает один вечер» → недоказанное рекламное обещание.
- «SEO-отчёты и аудит сайта в том же кабинете» → обещает flow, который не представлен в основной navigation.

## G. Mobile problems

- Connections имеет document-level horizontal overflow 693/375.
- Поздние dashboard tabs скрыты.
- Auth tabs тесные, «Сбросить пароль» переносится.
- До 26 touch targets на одном экране меньше 44 px.
- При asset limiting mobile auth может быть полностью без CSS.
- Account row labels/actions обрезаются.
- Internal IDs и длинные scope/status строки ухудшают переносы.
- Нет отдельного mobile action hierarchy для provider/account rows.

## H. Accessibility

### Axe automated

- Critical: `aria-required-children` на auth tablist, desktop/mobile.
- Serious: `color-contrast` у основного signup CTA, около 1.17:1.
- Critical: `select-name` у выбора роли invitation form.

### Manual

- Много touch targets меньше 44 px.
- Disabled controls не объясняют причину.
- Asset `503` уничтожает CSS, visual hierarchy и usable interaction.
- Mobile horizontal overflow меняет порядок/доступность действий.
- Auth keyboard order в успешной загрузке логичен; links/buttons имеют заметный outline, inputs получают border/box-shadow focus. Это работающая часть, которую нельзя потерять.
- Modal focus нельзя было честно подтвердить без destructive/credential-bearing production actions; требуется отдельный non-production authenticated contour.

## I. Где V1 была лучше

- Client-specific MCP setup для Codex, Claude и ChatGPT.
- Copy token и copy Authorization actions.
- Более явный account selector/save flow и loading/empty states.
- Reports с PDF и DOCX и более предметным preview.
- Profile с nickname/avatar/password affordances.
- Более ясная «Начало работы» navigation.
- Меньше raw RBAC/billing/telemetry terminology.
- Более понятное разделение self-service OAuth и support.
- Поздние V1 fixes лучше сохраняли OAuth return-to-origin, session и reconnect expectations.

## J. Где V2 сейчас лучше V1

- Более цельная базовая dark palette и типографическая аккуратность при успешной загрузке assets.
- Inline account selection потенциально быстрее отдельного modal на desktop.
- Service tokens имеют account scopes, expiry/revocation и write default-deny architecture.
- Workspace/team management и billing foundation реально существуют.
- Overview counts и provider statuses могут быть полезны, если перевести их в state-aware customer language.
- One-time token reveal соответствует более сильной security model.
- Focus styling links/buttons в проверенном auth flow заметно.

## K. Что обязательно сохранить

- V2 session/security/API/data model и tenant isolation.
- One-time secret principle.
- Account-scoped service-token permissions и default-deny writes.
- Copyable MCP URL.
- Read-only provider/account integrity.
- Workspace switching для пользователей с несколькими workspace.
- Reports engine и billing entitlement enforcement под UI.
- Текущие работающие focus states.
- Спокойную dark palette без возврата старых security/backend решений.
- Никаких reconnect/provider ID changes ради UI.

# Что в моей предыдущей работе было сделано плохо

Предыдущая restoration работа восстановила отдельные цвета, формы и тексты V1, но не восстановила его interaction model достаточно точно. Я слишком рано объявил визуальную близость достигнутой, хотя MCP setup, reports, profile, account selection и mobile navigation стали менее понятными.

- Я добавил marketing hero внутрь operational dashboard без необходимости.
- Я использовал generic card-heavy SaaS composition и тем самым сделал разные по важности действия визуально одинаковыми.
- Я упростил V1 MCP onboarding настолько, что исчезли client-specific instructions и ключевые copy actions.
- Я оставил V2 domain vocabulary в customer UI: workspace, service token, scopes, entitlement, events, endpoints.
- Я допустил internal billing/analytics screens в главную navigation как будто это готовые клиентские разделы.
- Я не проверил `?mode=signup`, поэтому основной acquisition CTA ведёт не в тот state.
- Я не связал report period с request и оставил ложный control.
- Я не проверил role-gated navigation, поэтому часть ролей получает пустой MCP screen.
- Я не сделал account selection transaction понятной: нет save/pending/rollback/bulk selection.
- Я оставил destructive disconnect/token actions без confirmation.
- Я плохо проверил mobile Connections: горизонтальный overflow делает основной flow непригодным.
- Я не проверил UI под реальным production rate limit и пропустил P0, при котором Next assets получают `503`.
- Я не провёл axe-аудит до релиза и пропустил критическую ARIA tabs structure, contrast и unlabeled select.
- Я добавил слишком много объясняющего текста, который звучит как AI-generated SaaS или backend documentation.
- Я фактически сделал интерфейс визуально аккуратнее местами, но менее очевидным функционально. Это было ошибкой при задаче «V1 UX поверх V2 backend».

## Итоговая статистика

- P0: 1
- P1: 15
- P2: 19
- P3: 3
- UX findings: 28
- UI findings: 12
- Functional findings: 17
- Copy findings: 11
- Mobile findings: 5
- Accessibility findings: 6
- Consistency findings: 4
- AI-generated findings: 5
- Developer UI findings: 9

**AUDIT COMPLETE — AWAITING OWNER REVIEW**

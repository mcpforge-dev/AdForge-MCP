/* HolyMedia MCP dashboard.
   Onboarding flow: access code gate -> onboarding -> connections -> MCP setup.
   Uses only existing hosted/diagnostics endpoints. Never renders the access code
   or provider secrets. */
(function () {
  "use strict";

  const TOKEN_KEY = "ad_mcp_web_api_token";
  const MCP_URL_COPIED_KEY = "adforge_mcp_url_copied";
  const ACTIVE_SECTION_KEY = "adforge_active_section";
  const WELCOME_SEEN_KEY = "adforge_welcome_seen";
  const DISMISSED_PENDING_KEY_PREFIX = "adforge_dismissed_pending:";

  const PROVIDER_SLUG = {
    meta_ads: "meta",
    google_ads: "google",
    google_search_console: "search-console",
    tiktok_ads: "tiktok",
    yandex_direct: "yandex",
  };

  const PROVIDER_DESC = {
    meta_ads: "Кампании, статусы, бюджеты и базовые метрики из Meta Ads.",
    google_ads: "Кампании, статусы, бюджеты и базовые метрики из Google Ads.",
    google_search_console: "SEO-данные из Google Search Console: запросы, страницы, CTR, позиции и sitemap.",
    tiktok_ads: "Кабинеты, статусы и базовые данные из TikTok Ads после подключения.",
    yandex_direct: "Кабинеты, кампании и базовые данные из Yandex Direct после подключения.",
  };

  const TEST_MODE = new Set();

  const state = {
    section: "overview",
    authMode: "login",
    user: null,
    capabilities: null,
    connections: null,
    mcpToken: null,
    mcpOAuthClient: null,
    activePending: null,
    dismissedPendingIds: new Set(),
    pendingModalId: null,
    pendingWelcome: null,
    mcpUrlCopied: localStorage.getItem(MCP_URL_COPIED_KEY) === "1",
    notice: null,
    diagnosticsRun: false,
    seoReport: null,
    seoFilters: { siteUrl: "__all", days: "28" },
    siteAnalysisCopy: {},
    siteAnalysisHistory: [],
  };

  const el = {};

  /* ---------- boot ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    cache();
    bindLanding();
    bindAuth();
    bindGate();
    bindShell();
    boot();
  });

  function cache() {
    el.landing = document.getElementById("landing");
    el.landingLogin = document.getElementById("landing-login");
    el.landingRegister = document.getElementById("landing-register");
    el.authModal = document.getElementById("auth-modal");
    el.authForm = document.getElementById("auth-form");
    el.authNameField = document.getElementById("auth-name-field");
    el.authName = document.getElementById("auth-name");
    el.authEmail = document.getElementById("auth-email");
    el.authPassword = document.getElementById("auth-password");
    el.authConfirmField = document.getElementById("auth-confirm-field");
    el.authPasswordConfirm = document.getElementById("auth-password-confirm");
    el.authPasswordToggle = document.getElementById("auth-password-toggle");
    el.authForgot = document.getElementById("auth-forgot");
    el.authTitle = document.getElementById("auth-title");
    el.authSubtitle = document.getElementById("auth-subtitle");
    el.authGoogle = document.getElementById("auth-google");
    el.authSubmit = document.getElementById("auth-submit");
    el.authError = document.getElementById("auth-error");
    el.authSuccess = document.getElementById("auth-success");
    el.authSuccessApp = document.getElementById("auth-success-app");
    el.authTabs = Array.from(document.querySelectorAll("[data-auth-mode]"));
    el.clientModal = document.getElementById("client-modal");
    el.clientModalTitle = document.getElementById("client-modal-title");
    el.clientModalSubtitle = document.getElementById("client-modal-subtitle");
    el.clientModalBody = document.getElementById("client-modal-body");
    el.clientModalActions = document.getElementById("client-modal-actions");
    el.gate = document.getElementById("gate");
    el.gateForm = document.getElementById("gate-form");
    el.gateToken = document.getElementById("gate-token");
    el.gateSubmit = document.getElementById("gate-submit");
    el.gateError = document.getElementById("gate-error");
    el.app = document.getElementById("app");
    el.navTabs = Array.from(document.querySelectorAll(".nav-tab"));
    el.sections = Array.from(document.querySelectorAll("[data-section]"));
    el.previewBadge = document.getElementById("preview-badge");
    el.signout = document.getElementById("signout");
    el.overviewNotice = document.getElementById("overview-notice");
    el.overviewStats = document.getElementById("overview-stats");
    el.overviewCta = document.getElementById("overview-cta");
    el.siteAnalysisForm = document.getElementById("site-analysis-form");
    el.siteAnalysisUrl = document.getElementById("site-analysis-url");
    el.siteAnalysisType = document.getElementById("site-analysis-type");
    el.siteAnalysisGoal = document.getElementById("site-analysis-goal");
    el.siteAnalysisMode = document.getElementById("site-analysis-mode");
    el.siteAnalysisAudience = document.getElementById("site-analysis-audience");
    el.siteAnalysisRegion = document.getElementById("site-analysis-region");
    el.siteAnalysisCompetitor = document.getElementById("site-analysis-competitor");
    el.siteAnalysisConcern = document.getElementById("site-analysis-concern");
    el.siteAnalysisSubmit = document.getElementById("site-analysis-submit");
    el.siteAnalysisHistory = document.getElementById("site-analysis-history");
    el.siteAnalysisResult = document.getElementById("site-analysis-result");
    el.seoPanel = document.getElementById("seo-panel");
    el.seoNotice = document.getElementById("seo-notice");
    el.seoRefresh = document.getElementById("seo-refresh");
    el.seoToolbar = document.getElementById("seo-toolbar");
    el.reportLoadingModal = document.getElementById("report-loading-modal");
    el.nextSteps = document.getElementById("next-steps");
    el.mcpUrl = document.getElementById("mcp-url");
    el.copyMcpUrl = document.getElementById("copy-mcp-url");
    el.mcpUrlPanel = document.getElementById("mcp-url-panel");
    el.copyMcpUrlPanel = document.getElementById("copy-mcp-url-panel");
    el.mcpTokenStatus = document.getElementById("mcp-token-status");
    el.mcpTokenReveal = document.getElementById("mcp-token-reveal");
    el.mcpTokenRaw = document.getElementById("mcp-token-raw");
    el.copyMcpToken = document.getElementById("copy-mcp-token");
    el.copyMcpAuthHeader = document.getElementById("copy-mcp-auth-header");
    el.mcpTokenActions = document.getElementById("mcp-token-actions");
    el.mcpClientTabs = Array.from(document.querySelectorAll("[data-mcp-client-tab]"));
    el.mcpClientPanels = Array.from(document.querySelectorAll("[data-mcp-client-panel]"));
    el.mcpOAuthClientStatus = document.getElementById("mcp-oauth-client-status");
    el.mcpOAuthClientReveal = document.getElementById("mcp-oauth-client-reveal");
    el.mcpOAuthClientId = document.getElementById("mcp-oauth-client-id");
    el.mcpOAuthClientSecret = document.getElementById("mcp-oauth-client-secret");
    el.copyMcpOAuthClientId = document.getElementById("copy-mcp-oauth-client-id");
    el.copyMcpOAuthClientSecret = document.getElementById("copy-mcp-oauth-client-secret");
    el.mcpOAuthClientActions = document.getElementById("mcp-oauth-client-actions");
    el.profileCard = document.getElementById("profile-card");
    el.userPill = document.getElementById("user-pill");
    el.connectionsNotice = document.getElementById("connections-notice");
    el.pendingPanel = document.getElementById("pending-panel");
    el.connectionsList = document.getElementById("connections-list");
    el.connectionsRefresh = document.getElementById("connections-refresh");
    el.diagLive = document.getElementById("diag-live");
    el.diagRun = document.getElementById("diag-run");
    el.diagnosticsContent = document.getElementById("diagnostics-content");
    el.adminApp = document.getElementById("admin-app");
    el.adminContent = document.getElementById("admin-content");
    el.adminUserPill = document.getElementById("admin-user-pill");
    el.adminOpenApp = document.getElementById("admin-open-app");
    el.adminSignout = document.getElementById("admin-signout");
    el.toastRoot = document.getElementById("toast-root");
  }

  async function boot() {
    if (window.location.pathname === "/reset-password") {
      showLanding();
      showResetPasswordModal(new URLSearchParams(window.location.search).get("token") || "");
      return;
    }
    const googleLoginError = new URLSearchParams(window.location.search).get("google_login_error") || "";
    if (window.location.pathname === "/" && googleLoginError) {
      showLanding();
      openAuth("login");
      showAuthError(googleLoginError === "not_configured"
        ? "Вход через Google пока настраивается. Войдите по email и паролю или обратитесь к менеджеру HolyMedia."
        : humanizeError(googleLoginError));
      cleanUrl();
      return;
    }
    const oauthAuthorizeTarget = pendingOAuthAuthorizeTarget();
    if (window.location.pathname === "/" && oauthAuthorizeTarget) {
      try {
        await loadMeSilently();
      } catch (error) {
        state.user = null;
      }
      if (state.user) {
        window.location.href = oauthAuthorizeTarget;
        return;
      }
      showLanding();
      openAuth("login");
      showAuthError("Войдите в HolyMedia MCP, чтобы разрешить подключение AI-клиента.");
      return;
    }
    if (window.location.pathname === "/admin") {
      enterAdmin();
      return;
    }
    if (window.location.pathname === "/") {
      try {
        await loadMeSilently();
        if (state.user && hasDashboardRouteIntent()) {
          await loadCapabilities();
          enterApp();
          return;
        }
        if (state.user) {
          await loadCapabilities();
          window.history.replaceState({}, "", "/app");
          enterApp();
          return;
        }
      } catch (error) {
        state.user = null;
      }
      showLanding();
      if (hasDashboardRouteIntent()) {
        openAuth("login");
        showAuthError("Сессия истекла во время подключения. Войдите ещё раз и продолжите выбор аккаунтов.");
      }
      return;
    }
    try {
      await loadMeSilently();
      await loadCapabilities();
      enterApp();
    } catch (error) {
      if (error.status === 401 && !getToken()) {
        showLanding();
        openAuth("login");
        return;
      }
      showGate(error.status === 401 ? "" : humanizeError(error));
    }
  }

  async function loadCapabilities() {
    state.capabilities = await api("/api/beta/capabilities");
    return state.capabilities;
  }

  async function loadMeSilently() {
    try {
      const me = await api("/api/auth/me");
      state.user = me.authenticated ? me.user : null;
    } catch (error) {
      state.user = null;
    }
  }

  /* ---------- public landing and auth ---------- */

  function bindLanding() {
    document.querySelectorAll("[data-auth-open]").forEach((button) => {
      button.addEventListener("click", () => openAuth(button.dataset.authOpen || "login"));
    });
    el.landingLogin.addEventListener("click", () => openAuth("login"));
    el.landingRegister.addEventListener("click", () => openAuth("register"));
    initStepsReveal();
  }

  /* Sequential reveal for the "Три шага до первого ответа" block: step 1
     activates, the thread animates toward step 2, step 2 activates, and so
     on. Runs once per page load (IntersectionObserver, disconnected after
     the first trigger) and is skipped entirely under reduced motion. */
  function initStepsReveal() {
    const container = document.querySelector('[data-reveal="steps"]');
    if (!container) return;
    const steps = Array.from(container.querySelectorAll(".how-step"));
    if (!steps.length) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const activateAll = () => {
      steps.forEach((step) => step.classList.add("is-active"));
      container.dataset.progress = String(steps.length);
    };

    if (reduceMotion) {
      activateAll();
      return;
    }

    const runSequence = () => {
      container.classList.add("js-armed");
      steps.forEach((step, index) => {
        window.setTimeout(() => {
          step.classList.add("is-active");
          container.dataset.progress = String(index + 1);
        }, index * 380);
      });
    };

    if (!("IntersectionObserver" in window)) {
      activateAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            runSequence();
            observer.disconnect();
          }
        });
      },
      { threshold: 0.3 },
    );
    observer.observe(container);
  }

  function bindAuth() {
    document.querySelectorAll("[data-auth-close]").forEach((node) => {
      node.addEventListener("click", () => closeAuth());
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !el.authModal.hidden) closeAuth();
      if (event.key === "Escape" && el.clientModal && !el.clientModal.hidden) closeClientModal();
      if (event.key === "Tab") {
        const openModal = [el.clientModal, el.authModal].find((node) => node && !node.hidden);
        if (openModal) trapModalFocus(openModal, event);
      }
    });
    el.authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));
    el.authPasswordToggle.addEventListener("click", () => togglePasswordVisibility());
    if (el.authGoogle) {
      el.authGoogle.addEventListener("click", () => {
        window.location.assign("/auth/google/start");
      });
    }
    el.authForgot.addEventListener("click", () => {
      closeAuth();
      showForgotPasswordModal();
    });
    el.authSuccessApp.addEventListener("click", async () => {
      closeAuth();
      await loadCapabilities();
      window.history.replaceState({}, "", "/app");
      state.pendingWelcome = "register";
      enterApp();
    });
    el.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = {
        email: el.authEmail.value.trim(),
        password: el.authPassword.value,
      };
      if (state.authMode === "register") {
        if (el.authPassword.value.length < 8) {
          showAuthError("Пароль должен быть не короче 8 символов.");
          return;
        }
        if (el.authPassword.value !== el.authPasswordConfirm.value) {
          showAuthError("Пароль и подтверждение не совпадают.");
          return;
        }
        payload.name = el.authName.value.trim();
      }
      setLoading(el.authSubmit, true);
      hideAuthError();
      try {
        const result = await api(`/api/auth/${state.authMode}`, "POST", payload);
        state.user = result.user || null;
        if (state.authMode === "register") {
          showRegistrationSuccess();
          return;
        }
        const oauthTarget = pendingOAuthAuthorizeTarget();
        if (oauthTarget) {
          window.location.href = oauthTarget;
          return;
        }
        closeAuth();
        if (window.location.pathname === "/admin") {
          enterAdmin();
          return;
        }
        await loadCapabilities();
        window.history.replaceState({}, "", "/app");
        state.pendingWelcome = "login";
        enterApp();
      } catch (error) {
        showAuthError(humanizeError(error));
      } finally {
        setLoading(el.authSubmit, false);
      }
    });
  }

  function showLanding() {
    el.landing.hidden = false;
    el.gate.hidden = true;
    el.app.hidden = true;
    el.adminApp.hidden = true;
    closeAuth();
  }

  function trapModalFocus(modal, event) {
    const panel = modal.querySelector(".modal__panel") || modal;
    const focusables = [...panel.querySelectorAll(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    )].filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openAuth(mode) {
    state.authReturnFocus = document.activeElement;
    setAuthMode(mode === "register" ? "register" : "login");
    el.authModal.hidden = false;
    hideAuthError();
    el.authForm.hidden = false;
    el.authSuccess.hidden = true;
    resetPasswordVisibility();
    window.setTimeout(() => {
      const target = state.authMode === "register" ? el.authName : el.authEmail;
      target.focus();
    }, 0);
  }

  function closeAuth() {
    const wasOpen = !el.authModal.hidden;
    el.authModal.hidden = true;
    hideAuthError();
    el.authForm.reset();
    el.authForm.hidden = false;
    el.authSuccess.hidden = true;
    resetPasswordVisibility();
    if (wasOpen && state.authReturnFocus?.focus && document.contains(state.authReturnFocus)) {
      state.authReturnFocus.focus();
    }
    state.authReturnFocus = null;
  }

  function setAuthMode(mode) {
    state.authMode = mode === "register" ? "register" : "login";
    el.authTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.authMode === state.authMode));
    const isRegister = state.authMode === "register";
    el.authNameField.hidden = !isRegister;
    el.authName.required = isRegister;
    el.authConfirmField.hidden = !isRegister;
    el.authPasswordConfirm.required = isRegister;
    el.authPassword.autocomplete = isRegister ? "new-password" : "current-password";
    el.authForgot.hidden = isRegister;
    el.authForm.dataset.mode = state.authMode;
    el.authForm.hidden = false;
    el.authSuccess.hidden = true;
    resetPasswordVisibility();
    el.authTitle.textContent = isRegister ? "Создать аккаунт" : "Войти в HolyMedia MCP";
    el.authSubtitle.textContent = isRegister
      ? "Аккаунт нужен, чтобы подключить рекламные кабинеты и открыть их вашему AI-клиенту."
      : "Введите email и пароль, чтобы открыть личный кабинет.";
    el.authSubmit.textContent = isRegister ? "Создать аккаунт" : "Войти";
  }

  function showRegistrationSuccess() {
    hideAuthError();
    el.authTitle.textContent = "Аккаунт создан";
    el.authSubtitle.textContent = "Добро пожаловать в HolyMedia MCP.";
    el.authForm.hidden = true;
    el.authSuccess.hidden = false;
    el.authSuccessApp.focus();
  }

  function togglePasswordVisibility() {
    const shouldShow = el.authPassword.type === "password";
    el.authPassword.type = shouldShow ? "text" : "password";
    el.authPasswordToggle.textContent = shouldShow ? "Скрыть" : "Показать";
    el.authPasswordToggle.setAttribute("aria-label", shouldShow ? "Скрыть пароль" : "Показать пароль");
    el.authPasswordToggle.setAttribute("aria-pressed", shouldShow ? "true" : "false");
  }

  function resetPasswordVisibility() {
    el.authPassword.type = "password";
    el.authPasswordToggle.textContent = "Показать";
    el.authPasswordToggle.setAttribute("aria-label", "Показать пароль");
    el.authPasswordToggle.setAttribute("aria-pressed", "false");
  }

  function showAuthError(message) {
    el.authError.textContent = message;
    el.authError.hidden = false;
  }

  function hideAuthError() {
    el.authError.hidden = true;
  }

  function showForgotPasswordModal() {
    showClientModal({
      title: "Восстановление пароля",
      subtitle: "Введите email, который привязан к аккаунту HolyMedia MCP.",
      body: `
        <form id="forgot-password-form" class="auth-form">
          <label class="field">
            <span class="field__label">Email</span>
            <input name="email" type="email" autocomplete="email" placeholder="name@company.com" required>
          </label>
          <p class="modal__hint">Мы не показываем, существует аккаунт с такой почтой или нет.</p>
          <button type="submit" class="btn btn--primary btn--block">Отправить ссылку</button>
        </form>
      `,
      closeLabel: "",
    });
    const form = document.getElementById("forgot-password-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type='submit']");
      setLoading(button, true);
      try {
        await api("/api/auth/forgot-password", "POST", { email: form.email.value.trim() });
        showClientMessage(
          "Проверьте почту",
          "Если аккаунт с такой почтой существует, мы отправили ссылку для восстановления пароля.",
          "success",
        );
      } catch (error) {
        showClientMessage("Не удалось отправить письмо", humanizeError(error), "error");
      } finally {
        setLoading(button, false);
      }
    });
  }

  function showResetPasswordModal(token) {
    showClientModal({
      title: "Новый пароль",
      subtitle: "Введите новый пароль для аккаунта HolyMedia MCP.",
      body: `
        <form id="reset-password-form" class="auth-form">
          <input name="token" type="hidden" value="${escAttr(token)}">
          <label class="field">
            <span class="field__label">Новый пароль</span>
            <input name="new_password" type="password" autocomplete="new-password" placeholder="Минимум 8 символов" required>
          </label>
          <label class="field">
            <span class="field__label">Повторите пароль</span>
            <input name="confirm_password" type="password" autocomplete="new-password" placeholder="Повторите пароль" required>
          </label>
          <button type="submit" class="btn btn--primary btn--block">Сменить пароль</button>
        </form>
      `,
      closeLabel: "",
    });
    const form = document.getElementById("reset-password-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type='submit']");
      const newPassword = form.new_password.value;
      const confirmPassword = form.confirm_password.value;
      if (newPassword !== confirmPassword) {
        showClientMessage("Пароли не совпадают", "Повторите новый пароль ещё раз.", "warn");
        return;
      }
      setLoading(button, true);
      try {
        await api("/api/auth/reset-password", "POST", {
          token: form.token.value,
          new_password: newPassword,
          confirm_password: confirmPassword,
        });
        window.history.replaceState({}, "", "/");
        showClientMessage("Пароль изменён", "Теперь можно войти с новым паролем.", "success");
        window.setTimeout(() => {
          closeClientModal();
          openAuth("login");
        }, 1600);
      } catch (error) {
        showClientMessage("Ссылка не сработала", humanizeError(error), "error");
      } finally {
        setLoading(button, false);
      }
    });
  }

  /* ---------- token gate ---------- */

  function bindGate() {
    el.gateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = el.gateToken.value.trim();
      if (!token) {
        showGateError("Введите код доступа.");
        return;
      }
      setLoading(el.gateSubmit, true);
      setToken(token);
      try {
        state.capabilities = await api("/api/beta/capabilities");
        hideGateError();
        enterApp();
      } catch (error) {
        clearToken();
        showGateError(error.status === 401 ? "Неверный код доступа." : humanizeError(error));
      } finally {
        setLoading(el.gateSubmit, false);
      }
    });
  }

  function showGate(message) {
    el.landing.hidden = true;
    el.adminApp.hidden = true;
    el.app.hidden = true;
    closeAuth();
    el.gate.hidden = false;
    el.gateToken.value = "";
    if (message) showGateError(message);
    else hideGateError();
    el.gateToken.focus();
  }

  function showGateError(message) {
    el.gateError.textContent = message;
    el.gateError.hidden = false;
  }

  function hideGateError() {
    el.gateError.hidden = true;
  }

  function renderUserPill() {
    const label = state.user?.email || "Beta fallback";
    el.userPill.textContent = label;
    el.userPill.hidden = false;
    if (el.adminUserPill) {
      el.adminUserPill.textContent = label;
      el.adminUserPill.hidden = false;
    }
  }

  /* ---------- app shell ---------- */

  function bindShell() {
    el.navTabs.forEach((tab) => tab.addEventListener("click", () => setSection(tab.dataset.nav)));
    el.signout.addEventListener("click", () => logout());
    el.adminSignout.addEventListener("click", () => logout());
    el.adminOpenApp.addEventListener("click", () => {
      window.history.replaceState({}, "", "/app");
      boot();
    });
    el.mcpClientTabs.forEach((tab) => {
      const select = () => setMcpClientTab(tab.dataset.mcpClientTab);
      tab.addEventListener("click", select);
      tab.addEventListener("mouseenter", select);
      tab.addEventListener("focus", select);
    });
    el.connectionsRefresh.addEventListener("click", () => loadConnections());
    if (el.seoRefresh) el.seoRefresh.addEventListener("click", () => loadSeoReport({ force: true }));
    if (el.seoToolbar) el.seoToolbar.addEventListener("change", handleSeoFilterChange);
    if (el.seoToolbar) el.seoToolbar.addEventListener("click", handleSeoToolbarClick);
    el.diagRun.addEventListener("click", () => runDiagnostics());
    if (el.siteAnalysisForm) {
      el.siteAnalysisForm.addEventListener("submit", runSiteAnalysis);
    }
    if (el.siteAnalysisResult) {
      el.siteAnalysisResult.addEventListener("click", handleSiteAnalysisAction);
    }
    document.querySelectorAll("[data-client-modal-close]").forEach((node) => {
      node.addEventListener("click", () => closeClientModal());
    });
    el.copyMcpUrl.addEventListener("click", async () => {
      const url = el.mcpUrl.textContent.trim();
      if (!url || url === "—") return;
      await copyText(url);
      markMcpUrlCopied();
      showClientMessage("Адрес скопирован", "Теперь перейдите в раздел «AI-клиент» и выберите инструкцию для Codex, Claude или ChatGPT.", "success");
    });
    el.copyMcpUrlPanel.addEventListener("click", async () => {
      const url = el.mcpUrlPanel.textContent.trim();
      if (!url || url === "—") return;
      await copyText(url);
      markMcpUrlCopied();
      showClientMessage("Адрес подключения скопирован", "Вставьте этот URL при добавлении HolyMedia MCP в Codex, Claude или ChatGPT.", "success");
    });
    el.copyMcpToken.addEventListener("click", async () => {
      const token = el.mcpTokenRaw.textContent.trim();
      if (!token) return;
      await copyText(token);
      showClientMessage("Ключ доступа скопирован", "Сохраните его в безопасном месте. Полный ключ показывается только один раз.", "success");
    });
    el.copyMcpAuthHeader.addEventListener("click", async () => {
      const token = el.mcpTokenRaw.textContent.trim();
      if (!token) return;
      await copyText(`Bearer ${token}`);
      showClientMessage("Значение для Authorization скопировано", "В AI-клиенте добавьте заголовок Authorization и вставьте скопированное значение.", "success");
    });
    if (el.copyMcpOAuthClientId) {
      el.copyMcpOAuthClientId.addEventListener("click", async () => {
        const value = el.mcpOAuthClientId.textContent.trim();
        if (!value) return;
        await copyText(value);
        showClientMessage("Client ID скопирован", "Вставьте его в расширенные настройки Claude, если Claude попросит эти данные.", "success");
      });
    }
    if (el.copyMcpOAuthClientSecret) {
      el.copyMcpOAuthClientSecret.addEventListener("click", async () => {
        const value = el.mcpOAuthClientSecret.textContent.trim();
        if (!value) return;
        await copyText(value);
        showClientMessage("Client Secret скопирован", "Вставьте его в расширенные настройки Claude. Secret показывается только один раз.", "success");
      });
    }
  }

  function pendingOAuthAuthorizeTarget() {
    const value = new URLSearchParams(window.location.search).get("oauth_authorize") || "";
    if (!value) return "";
    try {
      const decoded = decodeURIComponent(value);
      if (!decoded.startsWith("/oauth/authorize?")) return "";
      return decoded;
    } catch (error) {
      return "";
    }
  }

  function setMcpClientTab(client) {
    if (!client) return;
    el.mcpClientTabs.forEach((tab) => {
      const active = tab.dataset.mcpClientTab === client;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    el.mcpClientPanels.forEach((panel) => {
      const active = panel.dataset.mcpClientPanel === client;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
  }

  async function logout() {
    try {
      await api("/api/auth/logout", "POST", {});
    } catch (error) {
      /* Service access code may not have a web session. */
    }
    clearToken();
    state.user = null;
    state.capabilities = null;
    state.connections = null;
    state.mcpToken = null;
    state.activePending = null;
    window.history.replaceState({}, "", "/");
    showLanding();
  }

  function enterApp() {
    el.landing.hidden = true;
    el.gate.hidden = true;
    el.adminApp.hidden = true;
    el.app.hidden = false;
    closeAuth();
    renderUserPill();
    applyPreviewBadge(state.capabilities);
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("oauth_error");
    const returnedProvider = params.get("provider");
    const pendingId = params.get("pending_id");
    const requested = params.get("section");
    if (oauthError) {
      state.notice = { tone: "error", text: humanizeError(oauthError) };
      showClientMessage("Ошибка подключения", humanizeError(oauthError), "error");
    } else if (pendingId && returnedProvider) {
      state.notice = { tone: "info", text: "Авторизация завершена. Выберите рекламные аккаунты, которые нужно подключить." };
    }
    cleanUrl();
    if (pendingId && returnedProvider) {
      setSection("connections");
      loadConnections().then(() => loadPending(returnedProvider, pendingId));
      return;
    }
    const savedSection = localStorage.getItem(ACTIVE_SECTION_KEY) || "";
    setSection(requested && isKnownSection(requested) ? requested : savedSection && isKnownSection(savedSection) ? savedSection : "overview");
    maybeShowWelcome();
  }

  function maybeShowWelcome() {
    const kind = state.pendingWelcome;
    state.pendingWelcome = null;
    if (!kind) return;
    try {
      if (sessionStorage.getItem(WELCOME_SEEN_KEY) === "1") return;
      sessionStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch (error) {
      /* ignore */
    }
    window.setTimeout(() => showWelcomeModal(kind), 120);
  }

  function showWelcomeModal(kind) {
    const isRegister = kind === "register";
    showClientModal({
      title: isRegister ? "Добро пожаловать в HolyMedia MCP" : "С возвращением",
      subtitle: isRegister
        ? "Три шага, и ваш AI-клиент начнёт отвечать на вопросы о рекламе."
        : "Кабинет готов к работе.",
      body: isRegister
        ? `
        <ol class="welcome-steps">
          <li><span><strong>Подключите платформу</strong> — Meta, Google, TikTok или Яндекс Директ.</span></li>
          <li><span><strong>Выберите рекламные аккаунты</strong>, с которыми будет работать AI.</span></li>
          <li><span><strong>Добавьте HolyMedia MCP в AI-клиент</strong> — Claude, ChatGPT или Codex.</span></li>
        </ol>
      `
        : "",
      closeLabel: "",
    });
    el.clientModalActions.innerHTML = `
      <button type="button" class="btn btn--primary" data-welcome-connections>Подключить платформу</button>
      <button type="button" class="btn btn--secondary" data-client-modal-close>Позже</button>
    `;
    el.clientModalActions.querySelector("[data-welcome-connections]")?.addEventListener("click", () => {
      closeClientModal();
      setSection("connections");
    });
    el.clientModalActions.querySelectorAll("[data-client-modal-close]").forEach((node) => {
      node.addEventListener("click", () => closeClientModal());
    });
  }

  function isKnownSection(section) {
    return el.navTabs.some((tab) => tab.dataset.nav === section);
  }

  function setSection(section) {
    state.section = isKnownSection(section) ? section : "overview";
    try {
      localStorage.setItem(ACTIVE_SECTION_KEY, state.section);
    } catch (error) {
      /* ignore */
    }
    el.navTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.nav === state.section));
    el.sections.forEach((node) => {
      node.hidden = node.dataset.section !== state.section;
    });
    if (state.section === "overview") loadOverview();
    if (state.section === "connections") loadConnections();
    if (state.section === "mcp") renderMcpPanel();
    if (state.section === "seo") loadSeoReport();
    if (state.section === "site-analysis") loadSiteAnalysisHistory();
    if (state.section === "diagnostics" && !state.diagnosticsRun) {
      el.diagnosticsContent.innerHTML = emptyState("Запустите диагностику, чтобы увидеть состояние сервиса.");
    }
    if (state.section === "profile") loadProfile();
  }

  function applyPreviewBadge(capabilities) {
    if (!el.previewBadge) return;
    const enabled = capabilities?.preview_only?.enabled !== false;
    el.previewBadge.textContent = enabled ? "Безопасный режим: без автозапуска" : "Режим подтверждения выключен";
    el.previewBadge.className = `badge ${enabled ? "badge--info" : "badge--err"}`;
  }

  function renderMcpPanel() {
    const mcpUrl = state.capabilities?.mcp?.url || state.connections?.mcp?.url || "";
    el.mcpUrlPanel.textContent = mcpUrl || "—";
    el.copyMcpUrlPanel.disabled = !mcpUrl;
    if (!state.user) {
      state.mcpToken = null;
      state.mcpOAuthClient = null;
      renderMcpTokenStatus(null, { sessionRequired: true });
      renderMcpOAuthClientStatus(null, { sessionRequired: true });
      return;
    }
    loadMcpToken();
    loadMcpOAuthClient();
  }

  async function loadMcpToken() {
    el.mcpTokenReveal.hidden = true;
    el.mcpTokenRaw.textContent = "";
    el.mcpTokenStatus.innerHTML = emptyState("Загружаем статус ключа...");
    el.mcpTokenActions.innerHTML = "";
    try {
      const payload = await api("/api/mcp-token");
      state.mcpToken = payload.token || null;
      renderMcpTokenStatus(state.mcpToken);
    } catch (error) {
      if (handle401(error)) return;
      renderMcpTokenStatus(null, { error: humanizeError(error) });
    }
  }

  function renderMcpTokenStatus(token, options = {}) {
    if (options.sessionRequired) {
      el.mcpTokenStatus.innerHTML = `
        <strong>Ключ доступа MCP</strong>
        <span>Войдите по email, чтобы создать персональный ключ доступа для Codex или Claude.</span>
      `;
      el.mcpTokenActions.innerHTML = `<button type="button" class="btn btn--primary btn--small" data-auth-open="login">Войти по email</button>`;
      el.mcpTokenActions.querySelector("[data-auth-open]").addEventListener("click", () => openAuth("login"));
      return;
    }
    if (options.error) {
      el.mcpTokenStatus.innerHTML = errorState(options.error);
      return;
    }
    const exists = Boolean(token?.exists);
    const active = exists && token.status === "active";
    el.mcpTokenStatus.innerHTML = `
      <strong>Ключ доступа MCP</strong>
      <div class="kv">
        <div class="kv-row"><span>Статус</span><strong>${statusBadgeMarkup(active ? "Активен" : exists ? "Отозван" : "Не создан", active ? "ok" : exists ? "warn" : "muted")}</strong></div>
        <div class="kv-row"><span>Создан</span><strong>${esc(formatTime(token?.created_at))}</strong></div>
        <div class="kv-row"><span>Последнее использование</span><strong>${esc(formatTime(token?.last_used_at))}</strong></div>
      </div>
      <span>Этот ключ нужен AI-клиенту, чтобы безопасно подключиться к вашему HolyMedia MCP. Полный ключ показывается только после создания или обновления.</span>
    `;
    el.mcpTokenActions.innerHTML = active
      ? `
        <button type="button" class="btn btn--secondary btn--small" data-mcp-token-action="rotate">Сгенерировать новый ключ</button>
        <button type="button" class="btn btn--danger btn--small" data-mcp-token-action="revoke">Отключить ключ</button>
      `
      : `<button type="button" class="btn btn--primary btn--small" data-mcp-token-action="create">Создать ключ доступа</button>`;
    el.mcpTokenActions.querySelectorAll("[data-mcp-token-action]").forEach((button) => {
      button.addEventListener("click", () => runMcpTokenAction(button.dataset.mcpTokenAction, button));
    });
  }

  async function runMcpTokenAction(action, button) {
    if (action === "revoke" && !window.confirm("Отключить текущий ключ доступа? После этого подключение в Codex или Claude перестанет работать.")) return;
    if (action === "rotate" && !window.confirm("Сгенерировать новый ключ доступа? Старый ключ перестанет работать.")) return;
    const endpoint = {
      create: "/api/mcp-token/create",
      rotate: "/api/mcp-token/rotate",
      revoke: "/api/mcp-token/revoke",
    }[action];
    if (!endpoint) return;
    setLoading(button, true);
    try {
      const payload = await api(endpoint, "POST", {});
      state.mcpToken = payload.token || null;
      renderMcpTokenStatus(state.mcpToken);
      if (payload.raw_token) {
        el.mcpTokenRaw.textContent = payload.raw_token;
        el.mcpTokenReveal.hidden = false;
        showClientMessage("Ключ доступа создан", "Скопируйте его сейчас: полный ключ показывается только один раз.", "success");
      } else {
        el.mcpTokenReveal.hidden = true;
        el.mcpTokenRaw.textContent = "";
        showClientMessage("Ключ доступа отключён", "Подключение в Codex или Claude перестанет работать, пока вы не создадите новый ключ.", "success");
      }
    } catch (error) {
      if (handle401(error)) return;
      showClientMessage("Не удалось обновить ключ", humanizeError(error), "error");
      renderMcpTokenStatus(state.mcpToken);
    }
  }

  async function loadProfile() {
    try {
      const payload = await api("/api/profile");
      renderProfile(payload.profile || null);
    } catch (error) {
      if (handle401(error)) return;
      el.profileCard.innerHTML = errorState(humanizeError(error));
    }
  }

  function renderProfile(profile = null) {
    const user = state.user;
    if (!user) {
      el.profileCard.innerHTML = `
        <h3 class="card__title">Служебный доступ</h3>
        <p class="card__hint">Вы вошли по коду доступа. Email-профиль появится после входа или регистрации.</p>
        <button type="button" class="btn btn--primary btn--small" data-auth-open="login">Войти по email</button>
      `;
      el.profileCard.querySelector("[data-auth-open]").addEventListener("click", () => openAuth("login"));
      return;
    }
    const data = profile || {
      email: user.email,
      nickname: user.name || "",
      avatar_url: "",
      account_status: user.status,
      connected_platforms: [],
      connected_platforms_count: 0,
      connected_ad_accounts_count: 0,
      created_at: null,
    };
    const initials = (data.nickname || data.email || "A").trim().slice(0, 1).toUpperCase();
    el.profileCard.innerHTML = `
      <form id="avatar-form" class="profile-layout" aria-label="Загрузка фотографии профиля">
        <label class="profile-avatar profile-avatar--button" title="Нажмите, чтобы загрузить фото">
          <input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          ${data.avatar_url ? `<img src="${escAttr(data.avatar_url)}" alt="Аватар профиля">` : `<span>${esc(initials)}</span>`}
        </label>
        <div class="profile-layout__copy">
          <h3 class="card__title">Аккаунт</h3>
          <p class="card__hint">Нажмите на аватар, чтобы загрузить фото.</p>
          <span class="profile-avatar__hint">JPG, PNG или WEBP до 2 MB.</span>
        </div>
      </form>
      <form id="profile-form" class="subsection">
        <label class="field">
          <span class="field__label">Никнейм</span>
          <input name="nickname" type="text" maxlength="80" value="${escAttr(data.nickname || "")}" required>
        </label>
        <div class="kv">
          <div class="kv-row"><span>Email</span><strong>${esc(data.email)}</strong></div>
          <div class="kv-row"><span>Статус аккаунта</span><strong>${esc(data.account_status === "active" ? "Активен" : data.account_status || "—")}</strong></div>
          <div class="kv-row"><span>Дата регистрации</span><strong>${esc(formatTime(data.created_at))}</strong></div>
          <div class="kv-row"><span>Подключённые платформы</span><strong>${esc((data.connected_platforms || []).map(providerLabel).join(", ") || "Нет")}</strong></div>
          <div class="kv-row"><span>Рекламные аккаунты</span><strong>${esc(data.connected_ad_accounts_count ?? 0)}</strong></div>
        </div>
        <button type="submit" class="btn btn--primary btn--small">Сохранить профиль</button>
      </form>
      <div class="subsection profile-password-form">
        <h3 class="card__title">Пароль</h3>
        <p class="card__hint">Пароль меняется в отдельном окне, чтобы не путать его с профилем.</p>
        <button id="open-change-password" type="button" class="btn btn--secondary btn--small">Сменить пароль</button>
      </div>
    `;
    bindProfileForms();
  }

  async function loadMcpOAuthClient() {
    if (!el.mcpOAuthClientStatus) return;
    el.mcpOAuthClientReveal.hidden = true;
    el.mcpOAuthClientId.textContent = "";
    el.mcpOAuthClientSecret.textContent = "";
    el.mcpOAuthClientStatus.innerHTML = emptyState("Загружаем данные подключения Claude...");
    el.mcpOAuthClientActions.innerHTML = "";
    try {
      const payload = await api("/api/mcp-oauth-client");
      state.mcpOAuthClient = payload.client || null;
      renderMcpOAuthClientStatus(state.mcpOAuthClient);
    } catch (error) {
      if (handle401(error)) return;
      renderMcpOAuthClientStatus(null, { error: humanizeError(error) });
    }
  }

  function renderMcpOAuthClientStatus(client, options = {}) {
    if (!el.mcpOAuthClientStatus) return;
    if (options.sessionRequired) {
      el.mcpOAuthClientStatus.innerHTML = `
        <strong>Данные подключения Claude</strong>
        <span>Войдите по email, чтобы создать данные для расширенных настроек Claude.</span>
      `;
      el.mcpOAuthClientActions.innerHTML = "";
      return;
    }
    if (options.error) {
      el.mcpOAuthClientStatus.innerHTML = errorState(options.error);
      return;
    }
    const exists = Boolean(client?.exists);
    const active = exists && client.status === "active";
    el.mcpOAuthClientStatus.innerHTML = `
      <strong>Данные подключения Claude</strong>
      <div class="kv">
        <div class="kv-row"><span>Статус</span><strong>${statusBadgeMarkup(active ? "Активен" : exists ? "Отозван" : "Не создан", active ? "ok" : exists ? "warn" : "muted")}</strong></div>
        <div class="kv-row"><span>Client ID</span><strong class="mono">${esc(client?.client_id || "—")}</strong></div>
        <div class="kv-row"><span>Secret prefix</span><strong class="mono">${esc(client?.client_secret_prefix || "—")}</strong></div>
      </div>
      <span>Если Claude зависает на Checking connection, создайте эти значения и вставьте их в расширенные настройки.</span>
    `;
    el.mcpOAuthClientActions.innerHTML = `
      <button type="button" class="btn btn--primary btn--small" data-mcp-oauth-client-action="create">${active ? "Сгенерировать новый Secret" : "Создать данные для Claude"}</button>
    `;
    el.mcpOAuthClientActions.querySelector("[data-mcp-oauth-client-action]").addEventListener("click", (event) => runMcpOAuthClientAction(event.currentTarget));
  }

  async function runMcpOAuthClientAction(button) {
    if (state.mcpOAuthClient?.exists && !window.confirm("Сгенерировать новые данные подключения Claude? Старый secret перестанет работать.")) return;
    setLoading(button, true);
    try {
      const payload = await api("/api/mcp-oauth-client/create", "POST", {});
      state.mcpOAuthClient = payload.client || null;
      renderMcpOAuthClientStatus(state.mcpOAuthClient);
      el.mcpOAuthClientId.textContent = state.mcpOAuthClient?.client_id || "";
      el.mcpOAuthClientSecret.textContent = payload.client_secret || "";
      el.mcpOAuthClientReveal.hidden = false;
      showClientMessage("Данные подключения Claude созданы", "Скопируйте Client ID и Client Secret сейчас: secret показывается только один раз.", "success");
    } catch (error) {
      if (handle401(error)) return;
      showClientMessage("Не удалось создать данные подключения Claude", humanizeError(error), "error");
      renderMcpOAuthClientStatus(state.mcpOAuthClient);
    } finally {
      setLoading(button, false);
    }
  }

  function bindProfileForms() {
    const profileForm = document.getElementById("profile-form");
    profileForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = profileForm.querySelector("button[type='submit']");
      setLoading(button, true);
      try {
        const payload = await api("/api/profile", "PUT", { nickname: profileForm.nickname.value });
        state.user = state.user ? { ...state.user, name: payload.profile.nickname } : state.user;
        renderUserPill();
        renderProfile(payload.profile);
        showClientMessage("Профиль сохранён", "Никнейм обновлён.", "success");
      } catch (error) {
        showClientMessage("Не удалось сохранить профиль", humanizeError(error), "error");
      } finally {
        setLoading(button, false);
      }
    });

    const uploadAvatar = async (avatarForm) => {
      const fileInput = avatarForm.querySelector("input[name='avatar']");
      const file = fileInput?.files?.[0];
      if (!file) {
        showClientMessage("Файл не выбран", "Выберите JPG, PNG или WEBP изображение.", "warn");
        return;
      }
      const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (!allowedTypes.has(file.type)) {
        showClientMessage("Неверный формат", "Загрузите JPG, PNG или WEBP изображение.", "warn");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        showClientMessage("Файл слишком большой", "Максимальный размер фотографии профиля — 2 MB.", "warn");
        return;
      }
      const button = avatarForm.querySelector("button[type='submit']");
      const body = new FormData();
      body.append("avatar", file);
      setLoading(button, true);
      try {
        const payload = await api("/api/profile/avatar", "POST", body);
        renderProfile(payload.profile);
        showClientMessage("Аватар загружен", "Фотография профиля обновлена.", "success");
      } catch (error) {
        showClientMessage("Ошибка загрузки файла", humanizeError(error), "error");
      } finally {
        setLoading(button, false);
      }
    };
    const avatarForm = document.getElementById("avatar-form");
    avatarForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await uploadAvatar(avatarForm);
    });
    avatarForm?.querySelector("input[name='avatar']")?.addEventListener("change", async () => {
      await uploadAvatar(avatarForm);
    });

    document.getElementById("open-change-password")?.addEventListener("click", () => showChangePasswordModal());
  }

  function showChangePasswordModal() {
    showClientModal({
      title: "Сменить пароль",
      subtitle: "Введите текущий пароль и новый пароль для аккаунта.",
      body: `
        <form id="change-password-form" class="auth-form">
          <label class="field">
            <span class="field__label">Текущий пароль</span>
            <input name="current_password" type="password" autocomplete="current-password" required>
          </label>
          <label class="field">
            <span class="field__label">Новый пароль</span>
            <input name="new_password" type="password" autocomplete="new-password" placeholder="Минимум 8 символов" required>
          </label>
          <label class="field">
            <span class="field__label">Повторите новый пароль</span>
            <input name="confirm_password" type="password" autocomplete="new-password" required>
          </label>
          <button type="submit" class="btn btn--primary btn--block">Сохранить новый пароль</button>
        </form>
      `,
      closeLabel: "",
    });
    const passwordForm = document.getElementById("change-password-form");
    passwordForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (passwordForm.new_password.value !== passwordForm.confirm_password.value) {
        showClientMessage("Пароли не совпадают", "Повторите новый пароль ещё раз.", "warn");
        return;
      }
      const button = passwordForm.querySelector("button[type='submit']");
      setLoading(button, true);
      try {
        await api("/api/profile/change-password", "POST", {
          current_password: passwordForm.current_password.value,
          new_password: passwordForm.new_password.value,
          confirm_password: passwordForm.confirm_password.value,
        });
        passwordForm.reset();
        showClientMessage("Пароль изменён", "Теперь используйте новый пароль при следующем входе.", "success");
      } catch (error) {
        showClientMessage("Не удалось изменить пароль", humanizeError(error), "error");
      } finally {
        setLoading(button, false);
      }
    });
  }

  /* ---------- overview ---------- */

  async function loadOverview() {
    el.overviewNotice.innerHTML = "";
    el.overviewStats.textContent = "Загружаем статус...";
    try {
      const [capabilities, connections] = await Promise.all([
        api("/api/beta/capabilities"),
        api("/api/hosted/connections"),
      ]);
      state.capabilities = capabilities;
      state.connections = connections;
      applyPreviewBadge(capabilities);
      renderOverview(capabilities, connections);
    } catch (error) {
      if (handle401(error)) return;
      el.overviewStats.textContent = humanizeError(error);
    }
  }

  function renderOverview(capabilities, connections) {
    const platforms = connections.platforms || [];
    const connectedPlatforms = platforms.filter((p) => (p.accounts || []).length > 0);
    const connectedAccounts = connectedPlatforms.reduce((sum, p) => sum + (p.accounts || []).length, 0);
    const mcpUrl = capabilities?.mcp?.url || connections?.mcp?.url || "";

    el.mcpUrl.textContent = mcpUrl || "—";
    el.copyMcpUrl.disabled = !mcpUrl;
    if (el.mcpUrlPanel) {
      el.mcpUrlPanel.textContent = mcpUrl || "—";
      el.copyMcpUrlPanel.disabled = !mcpUrl;
    }

    el.overviewStats.textContent = platforms.length
      ? `Подключено ${connectedPlatforms.length} из ${platforms.length} ${pluralRu(platforms.length, "платформы", "платформ", "платформ")}, ${connectedAccounts} ${pluralRu(connectedAccounts, "аккаунт", "аккаунта", "аккаунтов")}.`
      : "Платформы ещё не загружены.";

    el.overviewNotice.innerHTML = state.notice ? noticeMarkup(state.notice.text, state.notice.tone) : "";

    const steps = [
      {
        text: "Подключите рекламную платформу",
        done: connectedPlatforms.length > 0 || hasPending(platforms),
        ctaLabel: "Подключить платформу",
        action: () => setSection("connections"),
      },
      {
        text: "Выберите рекламные аккаунты",
        done: connectedAccounts > 0,
        ctaLabel: "Выбрать аккаунты",
        action: () => setSection("connections"),
      },
      {
        text: "Скопируйте адрес подключения",
        done: state.mcpUrlCopied,
        ctaLabel: "Скопировать адрес",
        action: () => el.copyMcpUrl.click(),
      },
    ];
    el.nextSteps.innerHTML = steps
      .map((s) => `<li class="${s.done ? "is-done" : ""}">${esc(s.text)}</li>`)
      .join("");

    const nextStep = steps.find((s) => !s.done);
    el.overviewCta.innerHTML = nextStep
      ? `<button type="button" class="btn btn--primary btn--small" data-overview-cta>${esc(nextStep.ctaLabel)}</button>`
      : `<button type="button" class="btn btn--secondary btn--small" data-overview-cta>Открыть AI-клиента</button>`;
    el.overviewCta.querySelector("[data-overview-cta]").addEventListener("click", nextStep ? nextStep.action : () => setSection("mcp"));
  }

  function hasPending(platforms) {
    return platforms.some((p) => (p.pending_selections || []).some((x) => x.status === "pending_account_selection"));
  }

  async function runSiteAnalysis(event) {
    event.preventDefault();
    const url = el.siteAnalysisUrl.value.trim();
    if (!url) return;
    const request = {
      url,
      site_type: el.siteAnalysisType?.value || "",
      goal: el.siteAnalysisGoal?.value || "",
      mode: el.siteAnalysisMode?.value || "quick",
      audience: el.siteAnalysisAudience?.value || "",
      region: el.siteAnalysisRegion?.value || "",
      competitor: el.siteAnalysisCompetitor?.value || "",
      concern: el.siteAnalysisConcern?.value || "",
    };
    setLoading(el.siteAnalysisSubmit, true);
    el.siteAnalysisResult.hidden = false;
    el.siteAnalysisResult.innerHTML = emptyState(request.mode === "full" ? "Готовим полный аудит сайта..." : "Анализируем сайт...");
    try {
      const payload = await api("/api/site/analyze", "POST", request);
      renderSiteAnalysis(payload.analysis || null, payload.history_record?.id || "");
      loadSiteAnalysisHistory();
    } catch (error) {
      if (handle401(error)) return;
      el.siteAnalysisResult.innerHTML = errorState(humanizeError(error));
    } finally {
      setLoading(el.siteAnalysisSubmit, false);
    }
  }

  function renderSiteAnalysis(analysis, historyId = "") {
    if (!analysis) {
      el.siteAnalysisResult.innerHTML = errorState("Не удалось получить результат анализа.");
      return;
    }
    const reportText = siteAnalysisMarkdown(analysis);
    const heroText = heroCopyMarkdown(analysis);
    const tasksText = tasksMarkdown(analysis);
    state.siteAnalysisCopy = { reportText, heroText, tasksText, analysis, historyId };
    if (analysis.status !== "ok") {
      el.siteAnalysisResult.innerHTML = `
        <div class="site-analysis-report">
          <div class="site-analysis-summary">
            <h3>Не удалось открыть сайт</h3>
            <p>${esc(analysis.error || analysis.summary || "Страница недоступна.")}</p>
          </div>
          ${renderTopIssues(analysis.top_issues || [])}
        </div>
      `;
      return;
    }
    el.siteAnalysisResult.innerHTML = `
      <div class="site-analysis-report">
        <div class="site-analysis-summary">
          <div class="site-analysis-score-card">
            <span class="site-analysis-score">${esc(String(analysis.overall_score || "—"))}</span>
            <small>оценка сайта</small>
          </div>
          <div class="site-analysis-summary__body">
            <span class="site-source">AI-аудит страницы</span>
            <h3>Краткий вердикт</h3>
            <p>${esc(analysis.verdict?.summary || analysis.summary || "")}</p>
            <div class="site-analysis-verdict-grid">
              <div><strong>Главный риск</strong><span>${esc(analysis.verdict?.main_risk || "Не хватает данных для точного вывода.")}</span></div>
              <div><strong>Быстрый выигрыш</strong><span>${esc(analysis.verdict?.fastest_win || "Усилить первый экран, CTA и доверие.")}</span></div>
            </div>
            ${renderReportKpis(analysis)}
          </div>
          <div class="site-analysis-actions">
            <button type="button" class="btn btn--primary btn--small" data-site-download>Скачать отчёт</button>
            <button type="button" class="btn btn--secondary btn--small" data-site-copy="report">Скопировать отчёт</button>
            <details class="actions-menu">
              <summary class="btn btn--ghost btn--small">Ещё</summary>
              <div class="actions-menu__list">
                <button type="button" data-site-copy="tasks">Задачи команде</button>
                <button type="button" data-site-copy="hero">Тексты первого экрана</button>
                <button type="button" data-site-repeat>Новый анализ</button>
              </div>
            </details>
          </div>
        </div>
        ${renderAssumptions(analysis.assumptions || [])}
        <div class="site-result-tabs" role="tablist" aria-label="Разделы отчёта">
          ${[
            ["issues", "Приоритеты"],
            ["hero", "Первый экран"],
            ["plan", "План"],
            ["copy", "Готовые тексты"],
            ["diagnostics", "Диагностика"],
          ].map(([id, label], index) => `<button type="button" class="${index === 0 ? "is-active" : ""}" data-site-tab="${id}" role="tab" aria-selected="${index === 0 ? "true" : "false"}">${label}</button>`).join("")}
        </div>
        <div class="site-result-panel is-active" data-site-panel="issues">
          ${renderScorecards(analysis.scores || [])}
          ${renderTopIssues(analysis.top_issues || [])}
          ${renderQuickWins(analysis.quick_wins || [])}
        </div>
        <div class="site-result-panel" data-site-panel="hero" hidden>${renderFirstScreenReview(analysis.first_screen_review || {})}${renderReadyHero(analysis.ready_hero || {})}</div>
        <div class="site-result-panel" data-site-panel="plan" hidden>${renderOneDayPlan(analysis.one_day_plan || [])}${renderRecommendedStructure(analysis.recommended_structure || [])}${renderImplementationPlan(analysis.implementation_plan || [])}</div>
        <div class="site-result-panel" data-site-panel="copy" hidden>${renderRewrittenCopy(analysis.rewritten_copy || {})}</div>
        <div class="site-result-panel" data-site-panel="diagnostics" hidden>${renderAuditOverview(analysis.audit_overview || {})}${renderQuestions(analysis.questions || [])}</div>
      </div>
    `;
    el.siteAnalysisResult.querySelector(".actions-menu")?.addEventListener("click", (event) => {
      if (event.target.closest("[data-site-copy], [data-site-repeat]")) {
        event.currentTarget.removeAttribute("open");
      }
    });
  }

  async function loadSiteAnalysisHistory() {
    if (!el.siteAnalysisHistory || !state.user) return;
    try {
      const payload = await api("/api/site/history");
      const items = payload.items || [];
      state.siteAnalysisHistory = items;
      if (!items.length) {
        el.siteAnalysisHistory.hidden = true;
        el.siteAnalysisHistory.innerHTML = "";
        return;
      }
      el.siteAnalysisHistory.hidden = false;
      el.siteAnalysisHistory.innerHTML = `
        <h3 class="card__title">Последние анализы</h3>
        <div class="site-analysis-history__list">
          ${items.slice(0, 5).map((item, index) => `
            <button type="button" data-history-index="${escAttr(String(index))}">
              <strong>${esc(item.url || "Сайт")}</strong>
              <span>${esc(item.created_at || "")} · ${esc(String(item.overall_score || "—"))}/100</span>
            </button>
          `).join("")}
        </div>
      `;
      el.siteAnalysisHistory.querySelectorAll("[data-history-index]").forEach((node) => {
        node.addEventListener("click", () => {
          const index = Number(node.getAttribute("data-history-index") || "-1");
          const item = state.siteAnalysisHistory[index];
          if (!item?.analysis) return;
          renderSiteAnalysis(item.analysis, item.id || "");
          el.siteAnalysisResult.hidden = false;
        });
      });
    } catch (error) {
      if (!handle401(error)) {
        el.siteAnalysisHistory.hidden = true;
      }
    }
  }

  async function handleSiteAnalysisAction(event) {
    const target = event.target.closest("[data-site-copy], [data-site-repeat], [data-site-tab], [data-site-download]");
    if (!target) return;
    if (target.dataset.siteRepeat !== undefined) {
      el.siteAnalysisForm?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (target.dataset.siteTab) {
      const id = target.dataset.siteTab;
      el.siteAnalysisResult.querySelectorAll("[data-site-tab]").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.siteTab === id));
      el.siteAnalysisResult.querySelectorAll("[data-site-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.sitePanel !== id;
        panel.classList.toggle("is-active", panel.dataset.sitePanel === id);
      });
      return;
    }
    if (target.dataset.siteDownload !== undefined) {
      await downloadSiteAnalysisReport();
      return;
    }
    const key = target.dataset.siteCopy === "tasks" ? "tasksText" : target.dataset.siteCopy === "hero" ? "heroText" : "reportText";
    await copyText(state.siteAnalysisCopy[key] || "");
    toast("Скопировано", "success");
  }

  async function downloadSiteAnalysisReport() {
    const analysis = state.siteAnalysisCopy.analysis;
    const historyId = state.siteAnalysisCopy.historyId;
    if (!analysis || !historyId) {
      showClientMessage("Не удалось собрать отчёт", "Повторите анализ страницы, чтобы создать DOCX.", "error");
      return;
    }
    showReportLoading(true);
    try {
      const headers = {
        Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Type": "application/json",
      };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch("/api/site/report.docx", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ history_id: historyId }),
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const payload = await response.json();
          message = payload.error || payload.message || message;
        } catch (error) {
          // The report endpoint normally returns JSON errors; keep the HTTP fallback otherwise.
        }
        const reportError = new Error(message);
        reportError.status = response.status;
        throw reportError;
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `HolyMedia-MCP-site-audit-${safeFileDate()}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      toast("DOCX-отчёт скачан", "success");
    } catch (error) {
      showClientMessage("Не удалось собрать отчёт", humanizeError(error), "error");
    } finally {
      showReportLoading(false);
    }
  }

  function showReportLoading(visible) {
    if (!el.reportLoadingModal) return;
    el.reportLoadingModal.hidden = !visible;
  }

  function renderAssumptions(items) {
    if (!items.length) return "";
    return `<div class="site-analysis-cardlet"><h4>Допущения</h4><ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`;
  }

  function renderReportKpis(analysis) {
    const vertical = analysis.checks?.detected_vertical || "auto";
    const topCount = (analysis.top_issues || []).length;
    const dayCount = (analysis.one_day_plan || []).length;
    const cta = analysis.evidence?.audit_engine?.cta_texts || [];
    const ctaLabel = cta.length && cta[0] !== "не обнаружено в собранных данных" ? "Кнопка действия найдена" : "Кнопку действия нужно усилить";
    const confidence = analysis.audit_overview?.confidence || {};
    const security = (analysis.audit_overview?.pillars || []).find((item) => item.id === "security") || {};
    const nicheLabel = vertical === "auto" ? "определена автоматически" : vertical;
    const parts = [
      `Ниша: ${nicheLabel}`,
      `${topCount} ${pluralRu(topCount, "приоритет", "приоритета", "приоритетов")}`,
      `${dayCount} ${pluralRu(dayCount, "задача", "задачи", "задач")} на день`,
      ctaLabel,
    ];
    if (confidence.score) parts.push(`Достоверность: ${confidence.score}%`);
    if (Number.isFinite(Number(security.score))) parts.push(`Пассивная безопасность: ${security.score}/100`);
    return `<p class="site-analysis-kpis">${esc(parts.join(" · "))}</p>`;
  }

  function renderAuditOverview(overview) {
    if (!overview || !Object.keys(overview).length) {
      return `<div class="site-analysis-block"><h3>Диагностика</h3><p>Для этого сохранённого анализа расширенная диагностика ещё не собиралась. Запустите анализ повторно.</p></div>`;
    }
    const confidence = overview.confidence || {};
    const screenshots = overview.screenshots || {};
    const screenshotItems = [
      ["Desktop", screenshots.desktop || {}],
      ["Mobile", screenshots.mobile || {}],
    ].filter(([, item]) => item.captured && item.preview_data_url);
    return `<div class="site-diagnostics">
      <section class="site-diagnostics__intro">
        <div>
          <span class="site-source">Аудит на основе собранных данных</span>
          <h3>Что действительно проверено</h3>
          <p>Достоверность выводов: <strong>${esc(String(confidence.score || 0))}% · ${esc(confidence.label || "ограниченная")}</strong></p>
        </div>
        <div class="site-evidence-sources">${(confidence.sources || []).map((item) => `<span>${esc(item)}</span>`).join("")}</div>
      </section>
      ${screenshotItems.length ? `<section class="site-screenshot-grid" aria-label="Скриншоты проверенной страницы">
        ${screenshotItems.map(([label, item]) => `<figure>
          <div class="site-screenshot-frame"><img src="${escAttr(item.preview_data_url)}" alt="${escAttr(label)} screenshot проверенной страницы" loading="lazy"></div>
          <figcaption><strong>${esc(label)}</strong><span>${esc(String(item.viewport?.width || ""))}x${esc(String(item.viewport?.height || ""))}</span></figcaption>
        </figure>`).join("")}
      </section>` : ""}
      <div class="site-diagnostic-pillars">
        ${(overview.pillars || []).map((pillar) => `<section class="site-diagnostic-pillar ${scoreToneClass(pillar.score)}">
          <header>
            <div><h3>${esc(pillar.title || "Диагностика")}</h3><p>${esc(pillar.note || "")}</p></div>
            <strong>${esc(String(pillar.score ?? "—"))}<small>/100</small></strong>
          </header>
          <div class="site-score-bar" aria-hidden="true"><i style="width:${scoreWidth(pillar.score)}%"></i></div>
          <div class="site-diagnostic-checks">
            ${(pillar.checks || []).map((check) => `<article class="is-${escAttr(check.status || "unknown")}">
              <div><i aria-hidden="true"></i><strong>${esc(check.title || "Проверка")}</strong><span>${esc(auditStatusLabel(check.status))}</span></div>
              <p>${esc(check.evidence || "Нет данных")}</p>
              ${check.status === "pass" ? "" : `<small>${esc(check.action || "Нужна ручная проверка.")}</small>`}
            </article>`).join("")}
          </div>
        </section>`).join("")}
      </div>
      ${(confidence.limitations || []).length ? `<section class="site-audit-limitations"><h3>Границы анализа</h3><ul>${confidence.limitations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>` : ""}
    </div>`;
  }

  function auditStatusLabel(status) {
    if (status === "pass") return "пройдено";
    if (status === "fail") return "высокий риск";
    if (status === "warn") return "нужно проверить";
    return "нет данных";
  }

  function renderScorecards(items) {
    return `<div class="site-analysis-block"><h3>Оценка по направлениям</h3><div class="site-score-grid">${items.map((item) => `
      <div class="site-score-card ${scoreToneClass(item.score)}">
        <div><strong>${esc(item.area)}</strong><span>${esc(String(item.score))}/100</span></div>
        <div class="site-score-bar" aria-hidden="true"><i style="width:${scoreWidth(item.score)}%"></i></div>
        <p>${esc(item.explanation || "")}</p>
        <ul>${(item.problems || []).slice(0, 3).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      </div>
    `).join("")}</div></div>`;
  }

  function scoreWidth(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
  }

  function scoreToneClass(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number < 60) return "is-risk";
    if (number < 78) return "is-watch";
    return "is-strong";
  }

  function renderTopIssues(items) {
    return `<div class="site-analysis-block"><h3>Топ улучшений</h3><div class="site-issue-list">${items.map((item) => `
      <article class="${priorityToneClass(item.priority)}">
        <div class="site-issue-meta">
          <b>${esc(item.priority || "P2")}</b>
          <span>эффект ${esc(item.effect || "средний")}</span>
          <span>сложность ${esc(item.difficulty || "средняя")}</span>
        </div>
        <h4>${esc(item.title || "Улучшение")}</h4>
        <p><strong>Проблема:</strong> ${esc(item.problem || "")}</p>
        <p><strong>Почему важно:</strong> ${esc(item.why_it_matters || "")}</p>
        <p><strong>Что сделать:</strong> ${esc(item.what_to_do || "")}</p>
        ${item.evidence ? `<p><strong>Что найдено:</strong> ${esc(item.evidence)}</p>` : ""}
      </article>
    `).join("")}</div></div>`;
  }

  function priorityToneClass(priority) {
    if (priority === "P1") return "is-p1";
    if (priority === "P3") return "is-p3";
    return "is-p2";
  }

  function renderQuickWins(items) {
    return `<div class="site-analysis-block"><h3>Что поправить за 30-60 минут</h3><div class="site-win-grid">${items.map((item) => `
      <div><strong>${esc(item.title || "")}</strong><p>${esc(item.action || "")}</p><small>${esc(item.time || "")}</small></div>
    `).join("")}</div></div>`;
  }

  function renderFirstScreenReview(review) {
    if (!review || !Object.keys(review).length) return "";
    const found = review.found || {};
    const screenshot = review.screenshot || {};
    const visual = screenshot.visual_analysis || {};
    const example = review.example_hero || {};
    return `<div class="site-analysis-block">
      <h3>${esc(review.title || "Разбор первого экрана")}</h3>
      <div class="site-copy-grid">
        <div>
          <h4>Что понятно за 5 секунд</h4>
          <p>${esc(review.five_second_takeaway || "")}</p>
          <small>${esc(review.evidence_note || "")}</small>
        </div>
        <div>
          <h4>Что найдено</h4>
          <p><strong>H1:</strong> ${esc(found.h1 || "не найден")}</p>
          <p><strong>CTA:</strong> ${esc((found.ctas || []).join(", ") || "не найден")}</p>
          <p><strong>Доверие:</strong> ${esc((found.trust_near_cta || []).join(", ") || "нужно усилить")}</p>
        </div>
        <div>
          <h4>Визуальные сигналы</h4>
          <p>${screenshot.captured ? `Скриншот: ${esc(String(screenshot.viewport?.width || ""))}x${esc(String(screenshot.viewport?.height || ""))}` : "Скриншот не получен"}</p>
          <p>${visual.available ? `Тема: ${esc(visual.theme_guess || "mixed")}, яркость: ${esc(String(visual.average_luma || ""))}` : "Визуальный анализ скриншота недоступен"}</p>
          <ul>${(found.visual_notes || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>Что мешает заявке</h4>
          <ul>${(review.friction || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </div>
      </div>
      <div class="site-analysis-cardlet">
        <h4>${esc(example.label || "Пример первого экрана, не финальный дизайн")}</h4>
        <p><strong>H1:</strong> ${esc(example.h1 || "")}</p>
        <p><strong>Subtitle:</strong> ${esc(example.subtitle || "")}</p>
        <p><strong>CTA:</strong> ${esc(example.primary_cta || "")}${example.secondary_cta ? ` / ${esc(example.secondary_cta)}` : ""}</p>
        <p><strong>Визуальное направление:</strong> ${esc(example.visual_direction || "")}</p>
        <div class="site-trust-chips">${(example.trust_elements || []).map((item) => `<span>${esc(item)}</span>`).join("")}</div>
      </div>
    </div>`;
  }

  function renderReadyHero(hero) {
    if (!hero || !Object.keys(hero).length) return "";
    return `<div class="site-analysis-block"><h3>${esc(hero.title || "Пример первого экрана")}</h3>
      <div class="site-hero-preview">
        <div class="site-hero-preview__copy">
          <span>пример для дизайнера</span>
          <h4>${esc(hero.h1 || "")}</h4>
          <p>${esc(hero.subheadline || "")}</p>
          <div class="site-hero-buttons">
            <b>${esc(hero.primary_button || "")}</b>
            <em>${esc(hero.secondary_button || "")}</em>
          </div>
          <small>${esc(hero.microcopy || "")}</small>
        </div>
        <div class="site-hero-preview__side">
          <h4>Что поставить рядом</h4>
          <ul>${(hero.advantages || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
          <h4>Визуал и доверие</h4>
          <p>${esc(hero.visual || "")}</p>
          <div class="site-trust-chips">${(hero.trust_elements || []).map((item) => `<span>${esc(item)}</span>`).join("")}</div>
        </div>
      </div>
    </div>`;
  }

  function renderOneDayPlan(items) {
    if (!items.length) return "";
    return `<div class="site-analysis-block"><h3>Что сделать за 1 день</h3><div class="site-day-plan">${items.map((item, index) => `
      <article>
        <b>${esc(String(index + 1))}</b>
        <div>
          <h4>${esc(item.task || "")}</h4>
          <p>${esc(item.expected_effect || "")}</p>
          <span>${esc(item.owner || "")} · ${esc(item.time || "")}</span>
          <small>${esc(item.placement || "")}</small>
        </div>
      </article>
    `).join("")}</div></div>`;
  }

  function renderRewrittenCopy(copy) {
    const h1 = copy.h1_variants || [];
    return `<div class="site-analysis-block"><h3>Готовые тексты</h3>
      <div class="site-copy-grid">
        <div><h4>H1</h4>${h1.map((item) => `<p>${esc(item)}</p>`).join("")}</div>
        <div><h4>Подзаголовок</h4><p>${esc(copy.subheadline || "")}</p></div>
        <div><h4>CTA</h4>${(copy.cta_variants || []).map((item) => `<p>${esc(item)}</p>`).join("")}</div>
        <div><h4>Текст формы</h4><p>${esc(copy.form_text || "")}</p></div>
      </div>
    </div>`;
  }

  function renderRecommendedStructure(items) {
    return `<div class="site-analysis-block"><h3>Рекомендуемая структура страницы</h3><ol class="site-structure-list">${items.map((item) => `<li><strong>${esc(item.block || "")}</strong><span>${esc(item.purpose || "")}</span></li>`).join("")}</ol></div>`;
  }

  function renderImplementationPlan(items) {
    return `<div class="site-analysis-block"><h3>План для команды</h3><div class="site-plan-table">${items.map((item) => `
      <div><strong>${esc(item.task || "")}</strong><span>${esc(item.impact || "")}</span><span>${esc(item.difficulty || "")}</span><span>${esc(item.priority || "")}</span><span>${esc(item.owner || "")}</span></div>
    `).join("")}</div></div>`;
  }

  function renderQuestions(items) {
    return `<div class="site-analysis-block"><h3>Вопросы к владельцу сайта</h3><ol>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></div>`;
  }

  function siteAnalysisMarkdown(analysis) {
    const overview = analysis.audit_overview || {};
    const diagnosticLines = (overview.pillars || []).flatMap((pillar) => [
      `### ${pillar.title || "Диагностика"}: ${pillar.score ?? "—"}/100`,
      ...(pillar.checks || []).filter((check) => check.status !== "pass").map((check) => `- ${check.title}: ${check.evidence}. ${check.action}`),
    ]);
    return [
      `# AI-анализ сайта: ${analysis.url || ""}`,
      `Оценка: ${analysis.overall_score || "—"}/100`,
      analysis.verdict?.summary || analysis.summary || "",
      `Главный риск: ${analysis.verdict?.main_risk || ""}`,
      `Быстрый выигрыш: ${analysis.verdict?.fastest_win || ""}`,
      "",
      "## Разбор первого экрана",
      analysis.first_screen_review?.five_second_takeaway || "",
      ...((analysis.first_screen_review?.friction || []).map((x) => `- ${x}`)),
      "",
      "## Техническая диагностика",
      `Достоверность: ${overview.confidence?.score || 0}% (${overview.confidence?.label || "ограниченная"})`,
      ...diagnosticLines,
      "",
      "## Топ улучшений",
      ...(analysis.top_issues || []).map((x) => `- ${x.priority}: ${x.title}. ${x.what_to_do}`),
      "",
      "## Быстрые победы",
      ...(analysis.quick_wins || []).map((x) => `- ${x.title}: ${x.action}`),
      "",
      "## Что сделать за 1 день",
      ...(analysis.one_day_plan || []).map((x) => `- ${x.task}: ${x.owner}, ${x.time}. Эффект: ${x.expected_effect}. Где: ${x.placement}`),
    ].join("\n");
  }

  function heroCopyMarkdown(analysis) {
    const hero = analysis.ready_hero || {};
    const copy = analysis.rewritten_copy || {};
    if (hero && Object.keys(hero).length) {
      return [
        "## Пример первого экрана",
        `H1: ${hero.h1 || ""}`,
        `Подзаголовок: ${hero.subheadline || ""}`,
        `Основная кнопка: ${hero.primary_button || ""}`,
        `Вторичная кнопка: ${hero.secondary_button || ""}`,
        "Преимущества:",
        ...(hero.advantages || []).map((item) => `- ${item}`),
        `Микротекст: ${hero.microcopy || ""}`,
        `Визуал: ${hero.visual || ""}`,
        "Доверие рядом:",
        ...(hero.trust_elements || []).map((item) => `- ${item}`),
      ].join("\n");
    }
    return [
      "## H1",
      ...(copy.h1_variants || []),
      "## Подзаголовок",
      copy.subheadline || "",
      "## CTA",
      ...(copy.cta_variants || []),
      "## Текст формы",
      copy.form_text || "",
    ].join("\n");
  }

  function tasksMarkdown(analysis) {
    if ((analysis.one_day_plan || []).length) {
      return (analysis.one_day_plan || []).map((x) => `${x.owner}: ${x.task} | ${x.time} | эффект: ${x.expected_effect} | где: ${x.placement}`).join("\n");
    }
    return (analysis.implementation_plan || []).map((x) => `${x.priority} · ${x.owner}: ${x.task} | влияние: ${x.impact} | сложность: ${x.difficulty}`).join("\n");
  }

  function siteAnalysisDocumentHtml(analysis) {
    const scoreRows = (analysis.scores || []).map((x) => `<tr><td>${esc(x.area)}</td><td class="num">${esc(String(x.score))}/100</td><td>${esc(x.explanation || "")}</td></tr>`).join("");
    const issueRows = (analysis.top_issues || []).map((x) => `
      <tr>
        <td class="num">${esc(x.priority || "P2")}</td>
        <td><strong>${esc(x.title || "")}</strong><br><span>${esc(x.problem || "")}</span></td>
        <td>${esc(x.what_to_do || "")}</td>
        <td>${esc(x.evidence || "")}</td>
      </tr>
    `).join("");
    const planRows = (analysis.implementation_plan || []).map((x) => `<tr><td>${esc(x.task)}</td><td>${esc(x.impact)}</td><td>${esc(x.difficulty)}</td><td>${esc(x.priority)}</td><td>${esc(x.owner)}</td></tr>`).join("");
    const oneDayRows = (analysis.one_day_plan || []).map((x) => `<tr><td>${esc(x.task)}</td><td>${esc(x.owner)}</td><td>${esc(x.time)}</td><td>${esc(x.expected_effect)}</td><td>${esc(x.placement)}</td></tr>`).join("");
    const copy = analysis.rewritten_copy || {};
    const hero = analysis.ready_hero || {};
    const firstScreen = analysis.first_screen_review || {};
    const firstFound = firstScreen.found || {};
    const firstExample = firstScreen.example_hero || {};
    const auditOverview = analysis.audit_overview || {};
    const diagnosticRows = (auditOverview.pillars || []).flatMap((pillar) => (pillar.checks || []).map((check) => `
      <tr><td>${esc(pillar.title || "")}</td><td class="num">${esc(String(pillar.score ?? "—"))}/100</td><td>${esc(check.title || "")}</td><td>${esc(auditStatusLabel(check.status))}</td><td>${esc(check.evidence || "")}</td><td>${esc(check.status === "pass" ? "—" : check.action || "")}</td></tr>
    `)).join("");
    const desktopShot = auditOverview.screenshots?.desktop || {};
    const mobileShot = auditOverview.screenshots?.mobile || {};
    const screenshotHtml = [
      ["Desktop", desktopShot],
      ["Mobile", mobileShot],
    ].filter(([, item]) => item.captured && item.preview_data_url).map(([label, item]) => `<div class="shot"><img src="${escAttr(item.preview_data_url)}" alt="${escAttr(label)} screenshot"><p><strong>${esc(label)}</strong> · ${esc(String(item.viewport?.width || ""))}x${esc(String(item.viewport?.height || ""))}</p></div>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>HolyMedia MCP — аудит сайта</title>
      <style>
        @page{margin:22mm 18mm}
        :root{
          --doc-bg:#ffffff; --doc-surface:#f7f8fb; --doc-border:#dde1e8;
          --doc-ink:#171a20; --doc-ink-muted:#5b6472; --doc-accent:#3d5fd6;
        }
        body{font-family:Manrope,-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.55;color:var(--doc-ink);background:var(--doc-bg);font-size:13.5px}
        h1{font-size:28px;line-height:1.2;letter-spacing:-0.01em;font-weight:700;margin:0 0 10px;color:var(--doc-ink)}
        h2{font-size:20px;font-weight:700;margin:28px 0 12px;color:var(--doc-ink);border-bottom:1px solid var(--doc-border);padding-bottom:8px}
        h3{font-size:15px;font-weight:600;margin:16px 0 6px;color:var(--doc-ink)}
        p{margin:6px 0 10px}
        .doc-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;margin-bottom:18px;border-bottom:1px solid var(--doc-border)}
        .doc-header strong{font-size:14px;letter-spacing:-0.01em}
        .doc-header span{color:var(--doc-ink-muted);font-size:12px}
        .cover{border:1px solid var(--doc-border);border-radius:16px;padding:26px;margin-bottom:22px;background:var(--doc-surface)}
        .cover p{color:var(--doc-ink-muted);max-width:680px}
        .score{display:inline-block;color:var(--doc-accent);border:1px solid var(--doc-border);border-radius:12px;padding:10px 16px;font-size:26px;font-weight:700;margin-top:8px}
        .score small{display:block;color:var(--doc-ink-muted);font-size:11px;font-weight:600;margin-top:2px}
        .meta{width:100%;margin-top:16px}.meta td{border:0;border-top:1px solid var(--doc-border);padding:7px 0;color:var(--doc-ink-muted)}
        .section-note,.copy-box{background:var(--doc-surface);border:1px solid var(--doc-border);border-radius:12px;padding:14px;margin:12px 0}
        .hero-box{border:1px solid var(--doc-border);border-radius:14px;padding:16px;margin:12px 0;background:var(--doc-bg)}
        .hero-buttons span{display:inline-block;border:1px solid var(--doc-border);border-radius:10px;padding:7px 10px;margin:4px 6px 4px 0;font-weight:600}
        .shots{display:flex;gap:14px;align-items:flex-start}.shot{width:48%}.shot img{display:block;max-width:100%;height:auto;border:1px solid var(--doc-border);border-radius:8px}.shot p{font-size:12px;color:var(--doc-ink-muted)}
        table{border-collapse:collapse;width:100%;margin:12px 0 18px}
        td,th{border:1px solid var(--doc-border);padding:8px;vertical-align:top;text-align:left}
        th{background:var(--doc-surface);color:var(--doc-ink);font-weight:600}
        .num{white-space:nowrap;font-weight:600;color:var(--doc-ink)}
        .small{color:var(--doc-ink-muted);font-size:12px}
        .muted{color:var(--doc-ink-muted)}
        ul,ol{margin-top:8px}
        .doc-footer{margin-top:32px;padding-top:14px;border-top:1px solid var(--doc-border);color:var(--doc-ink-muted);font-size:11.5px;display:flex;justify-content:space-between}
      </style>
      </head><body>
      <header class="doc-header">
        <strong>HolyMedia MCP</strong>
        <span>Отчёт подготовлен ${esc(new Date().toLocaleDateString())}</span>
      </header>
      <section class="cover">
        <h1>AI-анализ сайта</h1>
        <p>Продуктовый и конверсионный аудит публичной страницы: что мешает заявкам, какие правки важнее и что можно передать команде в работу.</p>
        <div class="score">${esc(String(analysis.overall_score || "—"))}/100<small>оценка сайта</small></div>
        <table class="meta">
          <tr><td><strong>Сайт:</strong></td><td>${esc(analysis.url || "")}</td></tr>
          <tr><td><strong>Дата:</strong></td><td>${esc(new Date().toLocaleString())}</td></tr>
          <tr><td><strong>Режим:</strong></td><td>${esc(analysis.mode || "")}</td></tr>
        </table>
      </section>
      <h2>Краткий вердикт</h2>
      <div class="section-note">
        <p>${esc(analysis.verdict?.summary || analysis.summary || "")}</p>
        <p><strong>Главный риск:</strong> ${esc(analysis.verdict?.main_risk || "")}</p>
        <p><strong>Быстрый выигрыш:</strong> ${esc(analysis.verdict?.fastest_win || "")}</p>
      </div>
      <h2>Оценка по направлениям</h2><table><tr><th>Направление</th><th>Оценка</th><th>Комментарий</th></tr>${scoreRows}</table>
      <h2>Диагностика и доказательства</h2>
      <div class="section-note"><p><strong>Достоверность:</strong> ${esc(String(auditOverview.confidence?.score || 0))}% · ${esc(auditOverview.confidence?.label || "ограниченная")}</p><p><strong>Источники:</strong> ${esc((auditOverview.confidence?.sources || []).join(", "))}</p></div>
      ${screenshotHtml ? `<div class="shots">${screenshotHtml}</div>` : ""}
      <table><tr><th>Направление</th><th>Оценка</th><th>Проверка</th><th>Статус</th><th>Evidence</th><th>Действие</th></tr>${diagnosticRows}</table>
      <h2>Топ улучшений</h2><table><tr><th>Приоритет</th><th>Проблема</th><th>Что сделать</th><th>Что найдено</th></tr>${issueRows}</table>
      <h2>Разбор первого экрана</h2>
      <div class="section-note">
        <p>${esc(firstScreen.five_second_takeaway || "")}</p>
        <p><strong>H1:</strong> ${esc(firstFound.h1 || "не найден")}</p>
        <p><strong>CTA:</strong> ${esc((firstFound.ctas || []).join(", ") || "не найден")}</p>
        <p><strong>Что мешает заявке:</strong></p>
        <ul>${(firstScreen.friction || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <p><strong>${esc(firstExample.label || "Пример первого экрана, не финальный дизайн")}</strong></p>
      </div>
      <h2>Пример первого экрана</h2>
      <div class="hero-box">
        <h3>${esc(hero.h1 || "")}</h3>
        <p>${esc(hero.subheadline || "")}</p>
        <p class="hero-buttons"><span>${esc(hero.primary_button || "")}</span><span>${esc(hero.secondary_button || "")}</span></p>
        <p><strong>Преимущества:</strong> ${(hero.advantages || []).map((x) => esc(x)).join("; ")}</p>
        <p><strong>Микротекст:</strong> ${esc(hero.microcopy || "")}</p>
        <p><strong>Визуал:</strong> ${esc(hero.visual || "")}</p>
      </div>
      <h2>Что сделать за 1 день</h2><table><tr><th>Задача</th><th>Кто делает</th><th>Время</th><th>Ожидаемый эффект</th><th>Где внедрить</th></tr>${oneDayRows}</table>
      <h2>Быстрые правки</h2><ul>${(analysis.quick_wins || []).map((x) => `<li><strong>${esc(x.title)}</strong>: ${esc(x.action)} <span class="small">(${esc(x.time || "")})</span></li>`).join("")}</ul>
      <h2>Готовые тексты</h2>
      <div class="copy-box"><h3>H1</h3>${(copy.h1_variants || []).map((item) => `<p>${esc(item)}</p>`).join("")}</div>
      <div class="copy-box"><h3>Подзаголовок</h3><p>${esc(copy.subheadline || "")}</p></div>
      <div class="copy-box"><h3>CTA</h3>${(copy.cta_variants || []).map((item) => `<p>${esc(item)}</p>`).join("")}</div>
      <div class="copy-box"><h3>Текст формы</h3><p>${esc(copy.form_text || "")}</p></div>
      <h2>Рекомендуемая структура страницы</h2><ol>${(analysis.recommended_structure || []).map((x) => `<li><strong>${esc(x.block)}</strong> — ${esc(x.purpose)}</li>`).join("")}</ol>
      <h2>План внедрения</h2><table><tr><th>Задача</th><th>Влияние</th><th>Сложность</th><th>Приоритет</th><th>Ответственный</th></tr>${planRows}</table>
      <h2>Вопросы для уточнения</h2><ol>${(analysis.questions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      <footer class="doc-footer">
        <span>HolyMedia MCP · hello@holymedia.kz</span>
        <span>Отчёт для внутреннего и клиентского использования</span>
      </footer>
      </body></html>`;
  }

  function safeFileDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function priorityLabel(priority) {
    const value = String(priority || "").toLowerCase();
    if (value === "high") return "высокий приоритет";
    if (value === "medium") return "средний приоритет";
    if (value === "low") return "низкий приоритет";
    return "приоритет";
  }

  /* ---------- SEO ---------- */

  async function loadSeoReport(options = {}) {
    if (!el.seoPanel) return;
    if (!state.seoReport || options.force) {
      el.seoPanel.innerHTML = emptyState("Загружаем SEO-отчет...");
    }
    if (el.seoRefresh) setLoading(el.seoRefresh, true);
    try {
      const params = new URLSearchParams({
        site_url: state.seoFilters.siteUrl || "__all",
        days: state.seoFilters.days || "28",
      });
      const report = await api(`/api/seo/search-console?${params.toString()}`);
      state.seoReport = report;
      renderSeoReport(report);
    } catch (error) {
      if (handle401(error)) return;
      el.seoPanel.innerHTML = errorState(humanizeError(error));
    } finally {
      if (el.seoRefresh) setLoading(el.seoRefresh, false);
    }
  }

  function renderSeoReport(report) {
    if (!el.seoPanel) return;
    if (!report || report.status === "not_connected") {
      el.seoNotice.innerHTML = "";
      renderSeoToolbar(report);
      el.seoPanel.innerHTML = `
        <div class="seo-empty">
          <div>
            <h3 class="card__title">Подключите Google Search Console</h3>
            <p class="card__hint">${esc(report?.message || "После подключения появятся SEO-отчеты по запросам, страницам, CTR и позициям.")}</p>
          </div>
          <button type="button" class="btn btn--primary" data-seo-connect>Подключить Search Console</button>
        </div>
      `;
      el.seoPanel.querySelector("[data-seo-connect]")?.addEventListener("click", (event) => {
        startOAuth("google_search_console", event.currentTarget);
      });
      return;
    }
    renderSeoToolbar(report);
    if (report.status !== "ok") {
      el.seoNotice.innerHTML = noticeMarkup(report.message || "Не удалось получить SEO-отчет.", "error");
      el.seoPanel.innerHTML = renderSeoProperties(report.property_summaries || report.properties || [], report.selected_property);
      return;
    }
    el.seoNotice.innerHTML = "";
    const metrics = report.metrics || {};
    const range = report.date_range || {};
    const previousRange = report.previous_date_range || {};
    const deltas = report.deltas || {};
    el.seoPanel.innerHTML = `
      <div class="seo-report-head">
        <div>
          <span class="seo-source">Google Search Console</span>
          <h3 class="seo-title">${esc(seoSelectedTitle(report.selected_property))}</h3>
          <p class="card__hint">Период: ${esc(range.start_date || "")} - ${esc(range.end_date || "")}. Сравнение: ${esc(previousRange.start_date || "")} - ${esc(previousRange.end_date || "")}. Только просмотр, без изменений.</p>
        </div>
        <div class="seo-report-actions">
          <button type="button" class="btn btn--secondary btn--small" data-seo-export="doc">Скачать отчет</button>
          <button type="button" class="btn btn--secondary btn--small" data-seo-export="csv">CSV</button>
          <button type="button" class="btn btn--ghost btn--small" data-seo-connect>Переподключить</button>
        </div>
      </div>
      <div class="stats-grid seo-stats">
        ${seoMetricCard("Клики", metrics.clicks, deltas.clicks, "number")}
        ${seoMetricCard("Показы", metrics.impressions, deltas.impressions, "number")}
        ${seoMetricCard("CTR", metrics.ctr, deltas.ctr, "percent")}
        ${seoMetricCard("Средняя позиция", metrics.position, deltas.position, "number")}
      </div>
      ${renderSeoExecutiveSummary(report)}
      ${renderSeoInsights(report.insights || [])}
      ${renderSeoTrend(report.trend || [], metrics)}
      ${renderSeoProperties(report.property_summaries || [], report.selected_property)}
      <div class="subsection seo-grid">
        ${renderSeoTable("Топ запросов", report.top_queries || [], "query")}
        ${renderSeoTable("Топ страниц", report.top_pages || [], "page")}
      </div>
      ${renderSeoOpportunities(report.opportunities || [])}
      ${renderSeoSitemaps(report.sitemaps || {})}
    `;
    el.seoPanel.querySelector("[data-seo-connect]")?.addEventListener("click", (event) => {
      startOAuth("google_search_console", event.currentTarget);
    });
    el.seoPanel.querySelectorAll("[data-seo-export]").forEach((button) => {
      button.addEventListener("click", () => exportSeoReport(button.dataset.seoExport));
    });
  }

  function renderSeoToolbar(report) {
    if (!el.seoToolbar) return;
    const properties = report?.properties || [];
    if (!properties.length) {
      el.seoToolbar.hidden = true;
      el.seoToolbar.innerHTML = "";
      return;
    }
    const current = state.seoFilters.siteUrl || "__all";
    el.seoToolbar.hidden = false;
    el.seoToolbar.innerHTML = `
      <label class="field seo-toolbar__field">
        <span class="field__label">Ресурс</span>
        <select id="seo-property">
          <option value="__all" ${current === "__all" ? "selected" : ""}>Все ресурсы</option>
          ${properties.map((property) => {
            const value = property.site_url || property.account_id || "";
            return `<option value="${escAttr(value)}" ${current === value ? "selected" : ""}>${esc(property.site_url || property.name || value)}</option>`;
          }).join("")}
        </select>
      </label>
      <label class="field seo-toolbar__field seo-toolbar__field--period">
        <span class="field__label">Период</span>
        <select id="seo-days">
          ${[7, 28, 90].map((days) => `<option value="${days}" ${String(state.seoFilters.days) === String(days) ? "selected" : ""}>${days} дней</option>`).join("")}
        </select>
      </label>
      <div class="seo-toolbar__meta">
        <span>${properties.length} ${pluralRu(properties.length, "ресурс", "ресурса", "ресурсов")}</span>
        <span>Источник: Search Console API</span>
      </div>
    `;
  }

  function handleSeoFilterChange(event) {
    if (event.target?.id === "seo-property") {
      state.seoFilters.siteUrl = event.target.value || "__all";
      loadSeoReport({ force: true });
    }
    if (event.target?.id === "seo-days") {
      state.seoFilters.days = event.target.value || "28";
      loadSeoReport({ force: true });
    }
  }

  function handleSeoToolbarClick(event) {
    const action = event.target?.dataset?.seoExport;
    if (action) exportSeoReport(action);
  }

  function seoSelectedTitle(selected) {
    if (!selected) return "SEO-отчет";
    if (selected.site_url === "__all") return "Все ресурсы";
    return selected.site_url || selected.name || selected.account_id || "SEO-отчет";
  }

  function seoMetricCard(label, value, delta, type) {
    const valueText = type === "percent" ? formatPercent(value) : formatNumber(value);
    const deltaText = seoDeltaText(delta, type);
    return `
      <div class="stat seo-stat">
        <span class="stat__label">${esc(label)}</span>
        <span class="stat__value">${esc(valueText)}</span>
        ${deltaText}
      </div>
    `;
  }

  function seoDeltaText(delta, type) {
    if (!delta || delta.percent === null || delta.percent === undefined) {
      return `<span class="seo-delta seo-delta--muted">нет сравнения</span>`;
    }
    const percent = Math.abs(Number(delta.percent || 0));
    const sign = delta.direction === "up" ? "+" : delta.direction === "down" ? "-" : "";
    const tone = delta.improved === true ? "ok" : delta.improved === false ? "warn" : "muted";
    const suffix = type === "percent" ? ` (${sign}${formatPercent(Math.abs(Number(delta.absolute || 0)))})` : "";
    return `<span class="seo-delta seo-delta--${tone}">${sign}${formatPercent(percent)} к прошлому периоду${suffix}</span>`;
  }

  function renderSeoExecutiveSummary(report) {
    const score = seoScore(report);
    const items = seoExecutiveItems(report);
    const tone = score >= 75 ? "ok" : score >= 50 ? "warn" : "err";
    const verdict = score >= 75 ? "Сильная динамика" : score >= 50 ? "Есть точки роста" : "Нужна оптимизация";
    return `
      <section class="subsection seo-executive">
        <div class="seo-subhead">
          <h3 class="card__title">Короткий вывод</h3>
          <span>для клиентского отчета</span>
        </div>
        <p class="seo-executive__lead">Оценка ${esc(score)} из 100 ${statusBadgeMarkup(verdict, tone)}</p>
        <ul class="seo-summary-list">
          ${items.map((item) => `<li>${esc(item)}</li>`).join("")}
        </ul>
      </section>
    `;
  }

  function seoScore(report) {
    const metrics = report.metrics || {};
    const deltas = report.deltas || {};
    let score = 55;
    const ctr = Number(metrics.ctr || 0);
    const position = Number(metrics.position || 0);
    if (Number(deltas.clicks?.percent || 0) > 0) score += 12;
    if (Number(deltas.impressions?.percent || 0) > 0) score += 8;
    if (deltas.position?.improved === true) score += 8;
    if (ctr >= 0.04) score += 10;
    else if (ctr < 0.015) score -= 10;
    if (position > 0 && position <= 10) score += 7;
    else if (position >= 25) score -= 8;
    if ((report.opportunities || []).length >= 3) score += 4;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function seoExecutiveItems(report) {
    const metrics = report.metrics || {};
    const deltas = report.deltas || {};
    const topQuery = (report.top_queries || [])[0];
    const topPage = (report.top_pages || [])[0];
    const opportunity = (report.opportunities || [])[0];
    const items = [];
    items.push(`За период получено ${formatNumber(metrics.clicks)} кликов и ${formatNumber(metrics.impressions)} показов при CTR ${formatPercent(metrics.ctr)}.`);
    if (deltas.clicks?.percent !== null && deltas.clicks?.percent !== undefined) {
      const direction = Number(deltas.clicks.percent || 0) >= 0 ? "выросли" : "снизились";
      items.push(`Клики ${direction} на ${formatPercent(Math.abs(Number(deltas.clicks.percent || 0)))} к предыдущему периоду.`);
    }
    if (topQuery?.query) {
      items.push(`Главный поисковый запрос: «${topQuery.query}» — ${formatNumber(topQuery.clicks)} кликов, позиция ${formatNumber(topQuery.position)}.`);
    }
    if (topPage?.page) {
      items.push(`Самая заметная страница: ${topPage.page} — ${formatNumber(topPage.impressions)} показов.`);
    }
    if (opportunity?.query) {
      items.push(`Приоритет роста: усилить запрос «${opportunity.query}», где уже есть показы и позиция ${formatNumber(opportunity.position)}.`);
    }
    return items.slice(0, 5);
  }

  function renderSeoInsights(insights) {
    if (!insights.length) return "";
    const toneMap = { positive: "ok", warning: "warn", action: "info", info: "muted" };
    return `
      <section class="subsection seo-insights">
        <h3 class="card__title">Наблюдения</h3>
        <ul class="seo-insight-list">
          ${insights.map((insight) => `
            <li class="seo-insight-row">
              ${statusBadgeMarkup(insight.title || "Инсайт", toneMap[insight.tone] || "muted")}
              <span>${esc(insight.text || "")}</span>
            </li>
          `).join("")}
        </ul>
      </section>
    `;
  }

  function renderSeoProperties(properties, selected) {
    if (!properties.length) return "";
    const selectedId = selected?.site_url || selected?.account_id || "";
    return `
      <div class="subsection seo-properties">
        <div class="seo-subhead">
          <h3 class="card__title">Ресурсы Search Console</h3>
          <span>${properties.length} подключено</span>
        </div>
        <div class="seo-property-grid">
          ${properties.map((property) => `
            <article class="seo-property ${selectedId && selectedId === (property.site_url || property.account_id) ? "is-selected" : ""}">
              <strong>${esc(property.site_url || property.name || property.account_id || "Property")}</strong>
              <span>${esc(property.permission_level || "")}${property.property_type ? ` · ${esc(property.property_type)}` : ""}</span>
              ${property.metrics ? `<div class="seo-property__metrics">
                <span>${esc(formatNumber(property.metrics.clicks))} кликов</span>
                <span>${esc(formatNumber(property.metrics.impressions))} показов</span>
                <span>CTR ${esc(formatPercent(property.metrics.ctr))}</span>
              </div>` : property.message ? `<small>${esc(property.message)}</small>` : ""}
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderSeoTable(title, rows, key) {
    if (!rows.length) {
      return `
        <section class="seo-table-block">
          <h3 class="card__title">${esc(title)}</h3>
          ${emptyState("Данных пока нет. Проверьте выбранную property и период в Search Console.")}
        </section>
      `;
    }
    return `
      <section class="seo-table-block">
        <div class="seo-table__head">
          <h3 class="card__title">${esc(title)}</h3>
          <span>${rows.length} строк</span>
        </div>
        <div class="seo-data-table-wrap">
          <table class="seo-data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>${key === "query" ? "Запрос" : "Страница"}</th>
                <th>Клики</th>
                <th>Показы</th>
                <th>CTR</th>
                <th>Позиция</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row, index) => `
                <tr>
                  <td><span class="seo-rank">${index + 1}</span></td>
                  <td><strong>${esc(row[key] || "")}</strong></td>
                  <td>${esc(formatNumber(row.clicks))}</td>
                  <td>${esc(formatNumber(row.impressions))}</td>
                  <td>${esc(formatPercent(row.ctr))}</td>
                  <td>${esc(formatNumber(row.position))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSeoOpportunities(rows) {
    if (!rows.length) return "";
    return `
      <section class="subsection seo-table-block">
        <div class="seo-table__head">
          <h3 class="card__title">Запросы для роста</h3>
          <span>позиции 4-20</span>
        </div>
        <p class="card__hint">Запросы с заметными показами и средней позицией 4-20: обычно их стоит проверить на соответствие страницы, сниппет и внутренние ссылки.</p>
        <div class="seo-data-table-wrap">
          <table class="seo-data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Запрос</th>
                <th>Показы</th>
                <th>Клики</th>
                <th>CTR</th>
                <th>Позиция</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row, index) => `
                <tr>
                  <td><span class="seo-rank seo-rank--action">${index + 1}</span></td>
                  <td><strong>${esc(row.query || "")}</strong></td>
                  <td>${esc(formatNumber(row.impressions))}</td>
                  <td>${esc(formatNumber(row.clicks))}</td>
                  <td>${esc(formatPercent(row.ctr))}</td>
                  <td>${esc(formatNumber(row.position))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSeoTrend(rows, metrics = {}) {
    if (!rows.length) return "";
    const values = rows.map((row) => Number(row.clicks || 0));
    const max = Math.max(...values, 1);
    const width = 720;
    const height = 240;
    const pad = 28;
    const innerWidth = width - pad * 2;
    const innerHeight = height - pad * 2;
    const points = rows.map((row, index) => {
      const x = pad + (rows.length === 1 ? innerWidth / 2 : (index / (rows.length - 1)) * innerWidth);
      const y = pad + innerHeight - (Number(row.clicks || 0) / max) * innerHeight;
      return { x, y, row };
    });
    const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
    const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${height - pad} L ${points[0].x.toFixed(1)} ${height - pad} Z`;
    const avg = rows.length ? Number(metrics.clicks || 0) / rows.length : 0;
    return `
      <section class="seo-chart-card">
        <div class="seo-table__head">
          <div>
            <h3 class="card__title">Динамика кликов</h3>
            <p class="card__hint">Среднее за день: ${esc(formatNumber(avg))} кликов. Наведите на точки для значений.</p>
          </div>
          <span>max ${esc(formatNumber(max))}</span>
        </div>
        <div class="seo-line-chart" aria-label="Динамика кликов по дням">
          <svg viewBox="0 0 ${width} ${height}" role="img">
            <defs>
              <linearGradient id="seoTrendFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="currentColor" stop-opacity="0.28"></stop>
                <stop offset="100%" stop-color="currentColor" stop-opacity="0.02"></stop>
              </linearGradient>
            </defs>
            <line class="seo-axis" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"></line>
            <line class="seo-axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"></line>
            <path class="seo-area" d="${escAttr(area)}"></path>
            <path class="seo-line" d="${escAttr(line)}"></path>
            ${points.map((point) => `
              <circle class="seo-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4">
                <title>${esc(point.row.date || "")}: ${esc(formatNumber(point.row.clicks))} кликов</title>
              </circle>
            `).join("")}
            ${points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 4) === 0).map((point) => `
              <text class="seo-chart-label" x="${point.x.toFixed(1)}" y="${height - 7}" text-anchor="middle">${esc(String(point.row.date || "").slice(5))}</text>
            `).join("")}
          </svg>
        </div>
      </section>
    `;
  }

  function renderSeoSitemaps(sitemaps) {
    const items = sitemaps.items || [];
    return `
      <section class="subsection seo-table-block">
        <h3 class="card__title">Sitemap</h3>
        ${items.length ? `
          <div class="seo-table__rows">
            ${items.map((item) => `
              <div class="seo-row">
                <strong>${esc(item.path || "sitemap")}</strong>
                ${item.site_url ? `<span>${esc(item.site_url)}</span>` : ""}
                <span>Ошибки: ${esc(item.errors ?? 0)}</span>
                <span>Предупреждения: ${esc(item.warnings ?? 0)}</span>
                <span>${item.last_downloaded ? `Скачан: ${esc(item.last_downloaded)}` : "Еще не скачан"}</span>
              </div>
            `).join("")}
          </div>
        ` : emptyState("В Search Console не найдено отправленных sitemap для выбранной property.")}
      </section>
    `;
  }

  function exportSeoReport(kind) {
    const report = state.seoReport;
    if (!report || report.status !== "ok") {
      showClientMessage("Отчет пока не готов", "Сначала загрузите SEO-отчет по подключенному ресурсу.", "warn");
      return;
    }
    if (kind === "csv") {
      downloadText(`seo-report-${safeFileDate()}.csv`, seoCsv(report), "text/csv;charset=utf-8");
      return;
    }
    downloadText(`seo-report-${safeFileDate()}.rtf`, seoRtf(report), "application/rtf;charset=utf-8");
  }

  function seoCsv(report) {
    const rows = [["type", "name", "clicks", "impressions", "ctr", "position"]];
    (report.top_queries || []).forEach((row) => rows.push(["query", row.query, row.clicks, row.impressions, row.ctr, row.position]));
    (report.top_pages || []).forEach((row) => rows.push(["page", row.page, row.clicks, row.impressions, row.ctr, row.position]));
    return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  function seoRtf(report) {
    const metrics = report.metrics || {};
    const range = report.date_range || {};
    const title = `SEO-отчет: ${seoSelectedTitle(report.selected_property)}`;
    const lines = [
      rtfHeading("HolyMedia MCP", 20),
      rtfHeading(title, 32),
      rtfParagraph(`Период: ${range.start_date || ""} - ${range.end_date || ""}. Источник: Google Search Console. Только просмотр, без изменений.`),
      rtfHeading("Ключевые метрики", 24),
      rtfParagraph(`Клики: ${formatNumber(metrics.clicks)}   Показы: ${formatNumber(metrics.impressions)}   CTR: ${formatPercent(metrics.ctr)}   Средняя позиция: ${formatNumber(metrics.position)}`),
      rtfHeading("Короткий вывод", 24),
      ...seoExecutiveItems(report).map((item) => rtfBullet(item)),
      rtfHeading("Наблюдения", 24),
      ...(report.insights || []).map((item) => rtfBullet(`${item.title || "Инсайт"}: ${item.text || ""}`)),
      rtfHeading("Топ запросов", 24),
      rtfPlainTable(report.top_queries || [], "query"),
      rtfHeading("Топ страниц", 24),
      rtfPlainTable(report.top_pages || [], "page"),
      rtfHeading("Запросы для роста", 24),
      rtfPlainTable(report.opportunities || [], "query"),
      rtfParagraph(`\\par HolyMedia MCP \\emdash отчёт подготовлен ${new Date().toLocaleDateString()}`),
    ];
    return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Manrope;}{\\f1 Arial;}}\\fs22\\f1\\paperw11907\\paperh16840\\margl1134\\margr1134\\margt1134\\margb1134\n${lines.join("\\par\n")}\n}`;
  }

  function rtfHeading(text, size) {
    return `\\b\\fs${size} ${rtfEscape(text)}\\b0\\fs22`;
  }

  function rtfParagraph(text) {
    return rtfEscape(text);
  }

  function rtfBullet(text) {
    return `\\bullet\\tab ${rtfEscape(text)}`;
  }

  function rtfPlainTable(rows, key) {
    if (!rows.length) return rtfParagraph("Данных нет.");
    const headers = [key === "query" ? "Запрос" : "Страница", "Клики", "Показы", "CTR", "Позиция"];
    const body = rows.slice(0, 15).map((row) => [
      row[key] || "",
      formatNumber(row.clicks),
      formatNumber(row.impressions),
      formatPercent(row.ctr),
      formatNumber(row.position),
    ]);
    const colWidths = [5300, 1650, 1650, 1450, 1450];
    let cellx = 0;
    const cellxDef = colWidths.map((w) => { cellx += w; return `\\cellx${cellx}`; }).join("");
    const rowDef = (cells, bold) => {
      const cellsRtf = cells.map((cell) => `${bold ? "\\b" : ""} ${rtfEscape(String(cell))}${bold ? "\\b0" : ""}\\cell`).join("");
      return `\\trowd\\trgaph70\\trleft0${cellxDef}${cellsRtf}\\row`;
    };
    return [rowDef(headers, true), ...body.map((row) => rowDef(row, false))].join("\n");
  }

  function rtfEscape(value) {
    return String(value ?? "").replace(/[\\{}]/g, "\\$&").replace(/\n/g, "\\par ").split("").map((char) => {
      const code = char.charCodeAt(0);
      if (code <= 127) return char;
      const signed = code > 32767 ? code - 65536 : code;
      return `\\u${signed}?`;
    }).join("");
  }

  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------- connections ---------- */

  async function loadConnections() {
    el.connectionsNotice.innerHTML = state.notice ? noticeMarkup(state.notice.text, state.notice.tone) : "";
    if (!state.connections) el.connectionsList.innerHTML = emptyState("Загружаем подключения...");
    try {
      const connections = await api("/api/hosted/connections");
      state.connections = connections;
      renderConnections(connections);
    } catch (error) {
      if (handle401(error)) return;
      el.connectionsList.innerHTML = errorState(humanizeError(error));
    }
  }

  function renderConnections(connections) {
    el.connectionsNotice.innerHTML = state.notice ? noticeMarkup(state.notice.text, state.notice.tone) : "";
    const platforms = (connections && connections.platforms) || [];
    syncActivePending(platforms);
    el.pendingPanel.innerHTML = "";
    el.connectionsList.innerHTML = platforms.length
      ? platforms.map(renderPlatformCard).join("")
      : emptyState("Пока нет подключенных рекламных аккаунтов. Начните с подключения рекламной платформы.");
    bindConnectionActions();
    syncPendingModal();
  }

  function syncActivePending(platforms) {
    const pending = firstActivePending(platforms);
    if (state.activePending) {
      const stillExists = platforms.some((platform) =>
        (platform.pending_selections || []).some((item) =>
          item.pending_id === state.activePending.pending_id && item.status === "pending_account_selection",
        ),
      );
      if (!stillExists) state.activePending = null;
    }
    if (!state.activePending && pending && !isPendingDismissed(pending.pending_id)) {
      state.activePending = pending;
    }
  }

  function firstActivePending(platforms) {
    for (const platform of platforms) {
      const pending = (platform.pending_selections || []).find((item) => item.status === "pending_account_selection");
      if (pending) return pending;
    }
    return null;
  }

  function renderPlatformCard(platform) {
    const status = resolveStatus(platform);
    const accounts = platform.accounts || [];
    const testMode = TEST_MODE.has(platform.provider);
    const canConnect = Boolean(platform.oauth_configured);
    const connectLabel = !canConnect ? "Платформа настраивается" : status === "connected" ? "Переподключить" : "Подключить";

    const metaBits = platformMeta(platform, status, accounts);

    const accountsBlock = renderConnectedAccounts(accounts);

    const pending = (platform.pending_selections || []).find((x) => x.status === "pending_account_selection");
    const expired = (platform.pending_selections || []).find((x) => x.status === "expired");

    return `
      <article class="card platform-card">
        <div class="platform-card__head">
          <div>
            <h3 class="platform-card__name">${esc(platform.label || platform.provider)}</h3>
            <p class="platform-card__desc">${esc(PROVIDER_DESC[platform.provider] || "")}</p>
          </div>
          ${statusBadge(status, testMode)}
        </div>
        ${metaBits.length ? `<div class="platform-card__meta">${metaBits.join("")}</div>` : ""}
        <p class="platform-card__hint">${esc(statusHint(status, canConnect))}</p>
        ${accountsBlock}
        ${pending ? renderPendingCallout(platform, pending) : ""}
        ${expired && !pending ? renderExpiredCallout() : ""}
        <div class="platform-card__actions">
          <button type="button" class="btn btn--primary btn--small" data-oauth="${escAttr(platform.provider)}" ${canConnect ? "" : "disabled"}>${connectLabel}</button>
          ${accounts.length ? `<button type="button" class="btn btn--danger btn--small" data-disconnect="${escAttr(platform.provider)}">Отключить</button>` : ""}
        </div>
      </article>
    `;
  }

  function platformMeta(platform, status, accounts) {
    // Only surface real counts here; the badge and hint below already say what the status means.
    if (accounts.length) {
      return [`<span>Подключено аккаунтов <strong>${accounts.length}</strong></span>`];
    }
    if (status === "select_accounts") {
      const pending = (platform.pending_selections || []).find((x) => x.status === "pending_account_selection");
      const count = (pending?.accounts || []).length;
      return [`<span>Найдено аккаунтов <strong>${count}</strong></span>`];
    }
    return [];
  }

  function renderAccountRow(account) {
    const id = account.account_id || account.customer_id || account.advertiser_id || account.direct_client_login || "";
    return `
      <div class="account-row">
        <span>${esc(account.name || id || "Аккаунт")}</span>
        <span class="mono">${esc(id)}</span>
      </div>
    `;
  }

  function renderConnectedAccounts(accounts) {
    if (!accounts.length) return "";
    const rows = accounts.map(renderAccountRow).join("");
    if (accounts.length <= 3) {
      return `<div class="platform-card__accounts">${rows}</div>`;
    }
    return `
      <details class="platform-card__accounts platform-card__accounts--collapsed">
        <summary>
          <span>Показать кабинеты</span>
          <strong>${accounts.length}</strong>
        </summary>
        <div class="platform-card__accounts-list">${rows}</div>
      </details>
    `;
  }

  function renderPendingCallout(platform, pending) {
    const count = (pending.accounts || []).length;
    return `
      <div class="callout">
        <strong>Нужно выбрать рекламные аккаунты</strong>
        <span>Мы получили доступ к кабинету и нашли аккаунты: ${count}. Нажмите, чтобы выбрать нужные.</span>
        <button type="button" class="btn btn--secondary btn--small" data-pending="${escAttr(platform.provider)}" data-pending-id="${escAttr(pending.pending_id)}">Продолжить выбор аккаунтов</button>
      </div>
    `;
  }

  function renderExpiredCallout() {
    return `
      <div class="callout callout--warn">
        <strong>Сессия OAuth истекла</strong>
        <span>Время выбора аккаунтов истекло. Переподключите платформу, чтобы продолжить.</span>
      </div>
    `;
  }

  function renderPendingPanel(pending) {
    const accounts = pending.accounts || [];
    const activeAccounts = accounts.filter((account) => !isPendingAccountDisabled(account));
    const manualGoogle = isGoogleManualCustomerEntry(pending);
    const options = accounts.length
      ? accounts.map(renderPendingOption).join("")
      : emptyState("Аккаунты не найдены. Проверьте, что у пользователя есть доступ к рекламному кабинету.");
    return `
        <form id="pending-form" data-provider="${escAttr(pending.provider)}" data-pending-id="${escAttr(pending.pending_id)}">
          ${renderPendingDiagnostics(pending)}
          ${accounts.length ? `
          <div class="pending-toolbar">
            <label class="pending-select-all">
              <input type="checkbox" data-select-all ${activeAccounts.length ? "checked" : "disabled"}>
              <span>Все</span>
            </label>
            <button type="button" class="btn btn--ghost btn--small" data-clear-pending>Снять все</button>
            <span class="pending-count" data-pending-count>Выбрано ${activeAccounts.length} из ${activeAccounts.length}</span>
          </div>
          ` : ""}
          <div class="pending-list">${options}</div>
          ${manualGoogle ? renderGoogleManualCustomerEntry() : ""}
          <div class="pending-actions">
            <button type="submit" class="btn btn--primary" ${activeAccounts.length || manualGoogle ? "" : "disabled"}>Подключить выбранные</button>
            <button type="button" class="btn btn--ghost" data-cancel-pending>Закрыть</button>
          </div>
        </form>
    `;
  }

  function renderPendingDiagnostics(pending) {
    // Only surface this box when there's an actual snag to explain; the happy path speaks for itself via the account list below.
    const meta = pending?.metadata || {};
    if (pending.provider === "google_ads" && Object.keys(meta).length) {
      const blocked = meta.accessible_customers_status === "blocked";
      if (!blocked) return "";
      const detail = meta.provider_api_error ? `<small>${esc(meta.provider_api_error)}</small>` : "";
      return `
        <div class="pending-diagnostics">
        <strong>Список кабинетов не подтянулся автоматически</strong>
          <span>Можно завершить подключение вручную: введите Customer ID рекламного кабинета ниже.</span>
          ${detail}
        </div>
      `;
    }
    if (pending.provider !== "yandex_direct" || !Object.keys(meta).length) return "";
    const returned = Number(meta.api_clients_returned ?? 0);
    const archived = Number(meta.archived_clients ?? 0);
    const active = Number(meta.active_clients ?? Math.max(0, returned - archived));
    const fallback = meta.fallback_used === true || meta.fallback_used === "true";
    if (returned > 0 && !fallback) return "";
    if (returned === 0 && !fallback) {
      return `
        <div class="pending-diagnostics">
          <strong>Yandex Direct не вернул кабинеты</strong>
          <span>Проверьте права пользователя или агентский доступ в Yandex Direct.</span>
        </div>
      `;
    }
    return `
      <div class="pending-diagnostics">
        <strong>Подсказка Yandex Direct</strong>
        <span>Найдено клиентов: ${esc(returned)}</span>
        <span>Активных: ${esc(active)}</span>
        <span>Архивных/отключённых: ${esc(archived)}</span>
        <span>Fallback использован: ${fallback ? "да" : "нет"}</span>
      </div>
    `;
  }

  function isGoogleManualCustomerEntry(pending) {
    const meta = pending?.metadata || {};
    return pending?.provider === "google_ads" && String(meta.manual_customer_entry_allowed || "").toLowerCase() === "true";
  }

  function renderGoogleManualCustomerEntry() {
    return `
      <div class="pending-manual">
        <label class="field">
          <span class="field__label">Google Ads Customer ID</span>
          <input name="manual_customer_id" type="text" inputmode="numeric" autocomplete="off" placeholder="Например: 123-456-7890">
        </label>
        <p class="modal__hint">Customer ID находится в Google Ads в правом верхнем углу аккаунта. Можно вводить с дефисами или без них.</p>
      </div>
    `;
  }

  function isPendingAccountDisabled(account) {
    const archived = String(account?.yandex_archived || "").toUpperCase() === "YES";
    const disabled = account?.selection_disabled === true || String(account?.selection_disabled || "").toLowerCase() === "true";
    return archived || disabled || account?.status === "archived";
  }

  function renderPendingOption(account) {
    const id = account.account_id || account.customer_id || account.advertiser_id || account.direct_client_login || "";
    const disabled = isPendingAccountDisabled(account);
    const reason = account.disabled_reason || (disabled ? "Архивный/отключённый кабинет" : "");
    return `
      <label class="pending-option ${disabled ? "pending-option--disabled" : ""}">
        <input type="checkbox" name="account_id" value="${escAttr(id)}" ${disabled ? "disabled" : "checked"}>
        <span>
          <span class="pending-option__name">${esc(account.name || id || "Аккаунт")}</span>
          <span class="pending-option__id">${esc(id)}${reason ? ` · ${esc(reason)}` : ""}</span>
        </span>
      </label>
    `;
  }

  function bindConnectionActions() {
    el.connectionsList.querySelectorAll("[data-oauth]").forEach((btn) =>
      btn.addEventListener("click", () => startOAuth(btn.dataset.oauth, btn)),
    );
    el.connectionsList.querySelectorAll("[data-diag]").forEach((btn) =>
      btn.addEventListener("click", () => runPlatformDiagnostics(btn.dataset.diag, btn)),
    );
    el.connectionsList.querySelectorAll("[data-disconnect]").forEach((btn) =>
      btn.addEventListener("click", () => disconnect(btn.dataset.disconnect, btn)),
    );
    el.connectionsList.querySelectorAll("[data-pending]").forEach((btn) =>
      btn.addEventListener("click", () => loadPending(btn.dataset.pending, btn.dataset.pendingId)),
    );
  }

  function syncPendingModal() {
    if (!state.activePending) {
      if (state.pendingModalId) closeClientModal();
      state.pendingModalId = null;
      return;
    }
    const pending = state.activePending;
    if (state.pendingModalId === pending.pending_id && !el.clientModal.hidden) return;
    const accounts = pending.accounts || [];
    const manualGoogle = isGoogleManualCustomerEntry(pending);
    state.pendingModalId = pending.pending_id;
    showClientModal({
      title: accounts.length ? "Выберите рекламный аккаунт" : manualGoogle ? "Введите Google Ads Customer ID" : "Аккаунты не найдены",
      subtitle: accounts.length
        ? "Мы получили доступ к вашему рекламному кабинету. Выберите аккаунт, который нужно подключить к HolyMedia MCP."
        : manualGoogle
        ? "Google OAuth прошёл. Если API не вернул список кабинетов автоматически, введите Customer ID вручную."
        : "Проверьте, что у пользователя есть доступ к рекламному кабинету.",
      body: renderPendingPanel(pending),
      tone: accounts.length || manualGoogle ? "info" : "warn",
      closeLabel: accounts.length || manualGoogle ? "" : "Закрыть",
    });
    const form = el.clientModal.querySelector("#pending-form");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        savePending(form.dataset.provider, form, event.submitter);
      });
      const cancel = el.clientModal.querySelector("[data-cancel-pending]");
      if (cancel) {
        cancel.addEventListener("click", () => {
          closePendingModal(true);
        });
      }
      bindPendingSelectionControls(form);
    }
  }

  function hasDashboardRouteIntent() {
    const params = new URLSearchParams(window.location.search);
    return Boolean(
      params.get("section") ||
      params.get("pending_id") ||
      params.get("provider") ||
      params.get("oauth_error") ||
      params.get("status"),
    );
  }

  function bindPendingSelectionControls(form) {
    const checkboxes = Array.from(form.querySelectorAll("input[name='account_id']:not(:disabled)"));
    const manualCustomerId = form.querySelector("input[name='manual_customer_id']");
    const selectAll = form.querySelector("[data-select-all]");
    const clearButton = form.querySelector("[data-clear-pending]");
    const count = form.querySelector("[data-pending-count]");
    const submit = form.querySelector("button[type='submit']");
    if (!checkboxes.length && !manualCustomerId) {
      if (selectAll) selectAll.disabled = true;
      if (clearButton) clearButton.disabled = true;
      if (count) count.textContent = "Нет активных кабинетов для выбора";
      if (submit) submit.disabled = true;
      return;
    }

    const sync = () => {
      const selected = checkboxes.filter((input) => input.checked).length;
      const manualReady = manualCustomerId ? normalizeGoogleCustomerId(manualCustomerId.value).length === 10 : false;
      if (selectAll) {
        selectAll.checked = selected === checkboxes.length;
        selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
      }
      if (count) count.textContent = `Выбрано ${selected} из ${checkboxes.length}`;
      if (submit) submit.disabled = selected === 0 && !manualReady;
    };

    if (selectAll) {
      selectAll.addEventListener("change", () => {
        checkboxes.forEach((input) => {
          input.checked = selectAll.checked;
        });
        sync();
      });
    }
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        checkboxes.forEach((input) => {
          input.checked = false;
        });
        sync();
      });
    }
    checkboxes.forEach((input) => input.addEventListener("change", sync));
    if (manualCustomerId) manualCustomerId.addEventListener("input", sync);
    sync();
  }

  function rememberDismissedPending(pendingId) {
    if (!pendingId) return;
    state.dismissedPendingIds.add(pendingId);
    try {
      sessionStorage.setItem(`${DISMISSED_PENDING_KEY_PREFIX}${pendingId}`, "1");
    } catch (error) {
      /* ignore */
    }
  }

  function isPendingDismissed(pendingId) {
    if (!pendingId) return false;
    if (state.dismissedPendingIds.has(pendingId)) return true;
    try {
      return sessionStorage.getItem(`${DISMISSED_PENDING_KEY_PREFIX}${pendingId}`) === "1";
    } catch (error) {
      return false;
    }
  }

  function closePendingModal(dismiss = false) {
    if (dismiss && state.activePending?.pending_id) {
      rememberDismissedPending(state.activePending.pending_id);
    }
    state.pendingModalId = null;
    state.activePending = null;
    closeClientModal();
    if (state.connections) renderConnections(state.connections);
  }

  async function startOAuth(provider, button) {
    const slug = PROVIDER_SLUG[provider];
    if (!slug) return;
    setLoading(button, true);
    try {
      const payload = await api(`/api/hosted/oauth/${slug}/authorize-url`);
      if (!payload.authorization_url) throw new Error("Сервер не вернул ссылку авторизации.");
      window.location.assign(payload.authorization_url);
    } catch (error) {
      if (handle401(error)) return;
      setLoading(button, false);
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
      showClientMessage("Ошибка подключения", humanizeError(error), "error");
    }
  }

  async function loadPending(provider, pendingId) {
    const slug = PROVIDER_SLUG[provider];
    if (!slug || !pendingId) return;
    try {
      state.activePending = await api(`/api/hosted/oauth/${slug}/pending?pending_id=${encodeURIComponent(pendingId)}`);
      state.notice = null;
      if (!state.connections) state.connections = await api("/api/hosted/connections");
      renderConnections(state.connections);
    } catch (error) {
      if (handle401(error)) return;
      state.activePending = null;
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
      showClientMessage("Ошибка подключения", humanizeError(error), "error");
    }
  }

  async function savePending(provider, form, button) {
    const slug = PROVIDER_SLUG[provider];
    if (!slug || !state.activePending) return;
    const accountIds = Array.from(form.querySelectorAll("input[name='account_id']:checked")).map((i) => i.value);
    const manualCustomerId = form.querySelector("input[name='manual_customer_id']");
    if (manualCustomerId && manualCustomerId.value.trim()) {
      const cleanCustomerId = normalizeGoogleCustomerId(manualCustomerId.value);
      if (cleanCustomerId.length !== 10) {
        showClientMessage("Проверьте Customer ID", "Введите Google Ads Customer ID из 10 цифр. Можно с дефисами, например 123-456-7890.", "warn");
        return;
      }
      accountIds.push(cleanCustomerId);
    }
    if (!accountIds.length) {
      showClientMessage("Нужно выбрать аккаунт", "Отметьте хотя бы один рекламный аккаунт, чтобы завершить подключение.", "warn");
      return;
    }
    setLoading(button, true);
    try {
      await api(`/api/hosted/oauth/${slug}/select`, "POST", {
        pending_id: state.activePending.pending_id,
        account_ids: accountIds,
      });
      rememberDismissedPending(state.activePending.pending_id);
      state.activePending = null;
      state.pendingModalId = null;
      closeClientModal();
      state.notice = { tone: "success", text: "Аккаунты подключены. Теперь их можно использовать в AI-клиенте." };
      await loadConnections();
      showClientMessage("Аккаунт подключён", "Теперь HolyMedia MCP сможет использовать выбранные рекламные аккаунты в AI-клиенте.", "success");
    } catch (error) {
      if (handle401(error)) return;
      setLoading(button, false);
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
      showClientMessage("Ошибка подключения", humanizeError(error), "error");
    }
  }

  async function disconnect(provider, button) {
    if (!window.confirm("Отключить эту рекламную платформу? При необходимости её можно подключить заново.")) return;
    setLoading(button, true);
    try {
      await api("/api/hosted/connections/disconnect", "POST", { provider });
      if (state.activePending?.provider === provider) state.activePending = null;
      state.notice = { tone: "success", text: "Платформа отключена." };
      await loadConnections();
      showClientMessage("Аккаунт отключён", "Подключение платформы удалено. При необходимости его можно добавить заново.", "success");
    } catch (error) {
      if (handle401(error)) return;
      setLoading(button, false);
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
      showClientMessage("Ошибка отключения", humanizeError(error), "error");
    }
  }

  async function runPlatformDiagnostics(provider, button) {
    setLoading(button, true);
    try {
      const result = await api(`/api/diagnostics/platforms/${encodeURIComponent(provider)}?live=1`);
      const tone = result.status === "mcp_ready" ? "success" : result.status === "api_error" ? "error" : "info";
      state.notice = { tone, text: `${providerLabel(provider)}: ${statusLabel(result.status)}.` };
      await loadConnections();
    } catch (error) {
      if (handle401(error)) return;
      setLoading(button, false);
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
    }
  }

  /* ---------- diagnostics ---------- */

  async function runDiagnostics() {
    const live = el.diagLive.checked;
    setLoading(el.diagRun, true);
    el.diagnosticsContent.innerHTML = emptyState("Запускаем диагностику...");
    try {
      const [overview, security] = await Promise.all([
        api(`/api/diagnostics${live ? "?live=1" : ""}`),
        api("/api/diagnostics/security"),
      ]);
      state.diagnosticsRun = true;
      renderDiagnostics(overview, security);
    } catch (error) {
      if (handle401(error)) return;
      el.diagnosticsContent.innerHTML = errorState(humanizeError(error));
    } finally {
      setLoading(el.diagRun, false);
    }
  }

  function renderDiagnostics(overview, security) {
    const mcp = overview.mcp || {};
    const transport = mcp.transport || {};
    const platforms = overview.platforms || [];
    const caps = state.capabilities || {};

    const serviceKv = kvGrid([
      ["Общий статус", statusValue(overview.status)],
      ["Окружение", esc(overview.backend?.environment || "—")],
      ["Защита API", boolValue(overview.backend?.web_api_auth_required)],
      ["Preview-only", boolValue(overview.backend?.preview_only, true)],
    ]);

    const securityKv = kvGrid([
      ["Код доступа настроен", boolValue(security.beta_token_configured, true)],
      ["Защита API", boolValue(security.api_auth_required, true)],
      ["Preview-only", boolValue(security.preview_only, true)],
      ["Реальные изменения включены", boolValue(security.live_writes_enabled, false)],
      ["Токены возвращаются наружу", boolValue(security.tokens_returned, false)],
      ["Секреты скрываются", boolValue(security.secrets_redacted, true)],
    ]);

    const mcpKv = kvGrid([
      ["Transport", esc(transport.type || "—")],
      ["Статус", statusValue(mcp.status)],
      ["Авторизация нужна", boolValue(transport.auth_required, true)],
      ["Tools готовы", String((mcp.tools?.ready || []).length || (caps.mcp?.tools || []).length || "—")],
    ]);

    const platformRows = platforms.map((p) => {
      const cls = p.status === "mcp_ready" ? "kv-ok" : p.status === "api_error" ? "kv-err" : "kv-warn";
      return `<div class="kv-row"><span>${esc(p.label || p.provider)}</span><strong class="${cls}">${esc(statusLabel(p.status))}</strong></div>`;
    });

    const missingEnv = overview.missing_required_env || [];
    const issues = overview.issues || [];
    const nextActions = overview.next_actions || [];

    el.diagnosticsContent.innerHTML = `
      <div class="diag-grid">
        <article class="card"><h3 class="card__title">Сервис</h3>${serviceKv}</article>
        <article class="card"><h3 class="card__title">Безопасность</h3>${securityKv}</article>
        <article class="card"><h3 class="card__title">MCP transport</h3>${mcpKv}</article>
        <article class="card"><h3 class="card__title">Платформы</h3><div class="kv">${platformRows.join("") || emptyState("Платформы не найдены.")}</div></article>
      </div>
      ${nextActions.length ? `<article class="card"><h3 class="card__title">Что сделать дальше</h3><ul class="list-plain">${nextActions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></article>` : ""}
      ${missingEnv.length || issues.length ? `<article class="card"><h3 class="card__title">Технические детали для оператора</h3><ul class="list-plain">${[...issues, ...missingEnv.map((e) => `Не настроено: ${e}`)].map((i) => `<li>${esc(i)}</li>`).join("")}</ul></article>` : ""}
      <details class="raw-json">
        <summary>Технический JSON для оператора</summary>
        <pre>${esc(JSON.stringify({ overview, security }, null, 2))}</pre>
      </details>
    `;
  }

  /* ---------- admin ---------- */

  async function enterAdmin() {
    el.landing.hidden = true;
    el.gate.hidden = true;
    el.app.hidden = true;
    el.adminApp.hidden = false;
    closeAuth();
    try {
      const me = await api("/api/auth/me");
      state.user = me.user || null;
      renderUserPill();
      if (!state.user || state.user.role !== "admin") {
        el.adminContent.innerHTML = errorState("Доступ к /admin есть только у пользователя с ролью admin.");
        return;
      }
      await loadAdmin();
    } catch (error) {
      el.adminContent.innerHTML = `
        <article class="card">
          <h3 class="card__title">Нужен вход администратора</h3>
          <p class="card__hint">Войдите под email-аккаунтом с ролью admin. Старый код доступа не открывает админку.</p>
          <button id="admin-login-button" type="button" class="btn btn--primary btn--small">Войти</button>
        </article>
      `;
      document.getElementById("admin-login-button").addEventListener("click", () => openAuth("login"));
    }
  }

  async function loadAdmin() {
    el.adminContent.innerHTML = emptyState("Загружаем пользователей...");
    try {
      const [users, diagnostics] = await Promise.all([
        api("/api/admin/users"),
        api("/api/admin/diagnostics"),
      ]);
      renderAdmin(users.users || [], diagnostics);
    } catch (error) {
      el.adminContent.innerHTML = errorState(humanizeError(error));
    }
  }

  function renderAdmin(users, diagnostics) {
    const rows = users.map((user) => `
      <tr>
        <td><strong>${esc(user.name || "—")}</strong><br><span class="mono">${esc(user.email || "")}</span></td>
        <td>${esc(user.role || "user")}</td>
        <td>${statusBadgeMarkup(user.status === "active" ? "Активен" : "Отключён", user.status === "active" ? "ok" : "warn")}</td>
        <td>
          ${statusBadgeMarkup(user.mcp_token_status === "active" ? "Token активен" : user.mcp_token_status === "revoked" ? "Token отозван" : "Нет token", user.mcp_token_status === "active" ? "ok" : "muted")}<br>
          <span class="mono">${esc(user.mcp_token_prefix || "—")}</span><br>
          <span>${esc(formatTime(user.mcp_token_last_used_at))}</span>
        </td>
        <td>${esc(formatTime(user.created_at))}</td>
        <td>${esc(formatTime(user.last_login_at))}</td>
        <td>${esc(user.platform_connections ?? 0)}</td>
        <td>
          <div class="admin-table__actions">
            <button class="btn btn--secondary btn--small" data-admin-status="${escAttr(user.id)}" data-status="${user.status === "active" ? "disabled" : "active"}">${user.status === "active" ? "Отключить" : "Включить"}</button>
            <button class="btn btn--secondary btn--small" data-admin-role="${escAttr(user.id)}" data-role="${user.role === "admin" ? "user" : "admin"}">${user.role === "admin" ? "Сделать user" : "Сделать admin"}</button>
            ${user.mcp_token_status === "active" ? `<button class="btn btn--danger btn--small" data-admin-token-revoke="${escAttr(user.id)}">Отозвать MCP token</button>` : ""}
          </div>
        </td>
      </tr>
    `).join("");
    const database = diagnostics.database || {};
    const oauthProviders = diagnostics.oauth_readiness?.platforms || diagnostics.oauth?.providers || [];
    const oauthCards = oauthProviders.map(renderAdminOAuthCard).join("");
    el.adminContent.innerHTML = `
      <div class="diag-grid">
        <article class="card">
          <h3 class="card__title">Database</h3>
          ${kvGrid([
            ["Статус", statusValue(database.status)],
            ["Driver", esc(database.driver || "—")],
            ["Users", esc(database.users ?? "—")],
            ["Active sessions", esc(database.active_sessions ?? "—")],
            ["Active MCP tokens", esc(database.active_mcp_tokens ?? "—")],
          ])}
        </article>
        <article class="card">
          <h3 class="card__title">Security</h3>
          ${kvGrid([
            ["Preview-only", boolValue(diagnostics.security?.preview_only, true)],
            ["API token configured", boolValue(diagnostics.security?.beta_token_configured, true)],
            ["Secure cookies", boolValue(diagnostics.security?.auth_secure_cookies, true)],
            ["Auth rate limit", boolValue(diagnostics.security?.auth_rate_limit_enabled, true)],
            ["Public registration", boolValue(diagnostics.security?.public_registration_enabled)],
            ["Secrets redacted", boolValue(diagnostics.security?.secrets_redacted, true)],
          ])}
        </article>
      </div>
      ${oauthCards ? `<article class="card"><h3 class="card__title">OAuth setup</h3><div class="admin-oauth-grid">${oauthCards}</div></article>` : ""}
      <article class="card">
        <h3 class="card__title">Пользователи</h3>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Пользователь</th><th>Роль</th><th>Статус</th><th>MCP token</th><th>Создан</th><th>Последний вход</th><th>Платформы</th><th>Действия</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="8">Пользователей пока нет.</td></tr>`}</tbody>
          </table>
        </div>
      </article>
    `;
    el.adminContent.querySelectorAll("[data-admin-status]").forEach((button) => {
      button.addEventListener("click", () => updateAdminUser(button.dataset.adminStatus, { status: button.dataset.status }, "/api/admin/users/status", button));
    });
    el.adminContent.querySelectorAll("[data-admin-role]").forEach((button) => {
      button.addEventListener("click", () => updateAdminUser(button.dataset.adminRole, { role: button.dataset.role }, "/api/admin/users/role", button));
    });
    el.adminContent.querySelectorAll("[data-admin-token-revoke]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!window.confirm("Отозвать MCP token пользователя? Raw token не будет показан и восстановить его нельзя.")) return;
        updateAdminUser(button.dataset.adminTokenRevoke, {}, "/api/admin/users/mcp-token/revoke", button);
      });
    });
  }

  function renderAdminOAuthCard(provider) {
    const ready = provider.overall_status === "ready_to_connect" || provider.client_visible_status === "ready_to_connect";
    const missing = provider.missing_required_env || [];
    const setup = provider.setup_instructions || [];
    const actions = provider.required_operator_action || [];
    const blockers = provider.blockers || [];
    const authorize = provider.authorize_url || {};
    const redirectUrl = provider.expected_redirect_url || provider.redirect_url || "—";
    return `
      <div class="admin-oauth-card">
        <div class="admin-oauth-card__head">
          <strong>${esc(provider.label || provider.provider)}</strong>
          ${statusBadgeMarkup(ready ? "Готово клиенту" : "Платформа настраивается", ready ? "ok" : "warn")}
        </div>
        <div class="kv">
          <div class="kv-row"><span>Overall</span><strong>${esc(statusLabel(provider.overall_status || provider.client_visible_status || provider.status))}</strong></div>
          <div class="kv-row"><span>Env credentials</span><strong>${provider.credentials_present || provider.status === "configured" ? "есть" : "не хватает"}</strong></div>
          <div class="kv-row"><span>Public OAuth</span><strong>${provider.public_connection_enabled ? "включён" : "выключен"}</strong></div>
          <div class="kv-row"><span>Authorize URL</span><strong>${esc(statusLabel(authorize.status || "not_checked"))}</strong></div>
          <div class="kv-row"><span>Redirect URL</span><strong class="mono">${esc(redirectUrl)}</strong></div>
          <div class="kv-row"><span>Connected accounts</span><strong>${esc(provider.connected_account_count ?? 0)}</strong></div>
          <div class="kv-row"><span>Last attempt</span><strong>${esc(statusLabel(provider.last_oauth_attempt_status || "not_recorded"))}</strong></div>
        </div>
        ${missing.length ? `<p class="card__hint">Не настроено: ${esc(missing.join(", "))}</p>` : ""}
        ${blockers.length ? `<p class="card__hint">Блокеры: ${esc(blockers.join(", "))}</p>` : ""}
        ${actions.length ? `<div><strong class="mini-title">Что сделать оператору</strong><ul class="list-plain">${actions.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>` : ""}
        ${setup.length ? `<ul class="list-plain">${setup.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
      </div>
    `;
  }

  async function updateAdminUser(userId, payload, endpoint, button) {
    setLoading(button, true);
    try {
      await api(endpoint, "POST", { user_id: userId, ...payload });
      await loadAdmin();
      toast("Пользователь обновлён.", "success");
    } catch (error) {
      toast(humanizeError(error), "error");
      setLoading(button, false);
    }
  }

  /* ---------- status helpers ---------- */

  function resolveStatus(platform) {
    const accounts = platform.accounts || [];
    const pending = platform.pending_selections || [];
    const summary = platform.diagnostic_summary || {};
    const missingEnv = (summary.missing_required_env || []).length > 0;
    if (accounts.length) return "connected";
    if (pending.some((x) => x.status === "pending_account_selection")) return "select_accounts";
    if (pending.some((x) => x.status === "expired")) return "reconnect_required";
    if (platform.oauth_credentials_configured && platform.oauth_public_enabled === false) return "provider_setup_required";
    if (missingEnv || !platform.oauth_configured) return "credentials_missing";
    return "ready_to_connect";
  }

  function statusBadge(status, testMode) {
    // Color carries meaning, not decoration: green = connected, amber = needs your action now, everything else neutral.
    const map = {
      connected: ["Подключено", "ok"],
      ready_to_connect: ["Не подключено", "muted"],
      select_accounts: ["Выберите аккаунт", "warn"],
      reconnect_required: ["Нужно подключить заново", "warn"],
      provider_setup_required: ["Платформа настраивается", "muted"],
      credentials_missing: ["Платформа настраивается", "muted"],
      error: ["Ошибка подключения", "err"],
    };
    const [label, tone] = map[status] || ["Статус неизвестен", "muted"];
    const modeChip = testMode ? `<span class="badge badge--muted">Тестовый режим</span>` : "";
    return `<div class="status-badge-group">${modeChip}<span class="badge badge--${tone}">${esc(label)}</span></div>`;
  }

  function statusHint(status, canConnect) {
    if (status === "connected") return "Аккаунт подключён и готов к работе в AI-клиенте.";
    if (status === "select_accounts") return "Авторизация завершена. Выберите аккаунт, чтобы закончить подключение.";
    if (status === "reconnect_required") return "Время выбора аккаунта истекло. Подключите платформу заново.";
    if (status === "provider_setup_required") return "Мы заканчиваем настройку этой платформы. Подключение скоро станет доступно.";
    if (status === "credentials_missing") {
      return "Подключение этой платформы временно настраивается. Если нужно ускорить доступ, обратитесь к менеджеру HolyMedia.";
    }
    if (status === "ready_to_connect") return "Нажмите подключить и разрешите доступ к рекламному кабинету.";
    return canConnect ? "Нажмите подключить и разрешите доступ к рекламному кабинету." : "Платформа временно настраивается.";
  }

  function statusLabel(status) {
    return {
      mcp_ready: "подключение готово",
      ready: "готово",
      ok: "готово",
      connected: "подключено",
      not_connected: "не подключено",
      pending_account_selection: "выберите аккаунт",
      reconnect_required: "нужно подключить заново",
      token_expired: "нужно подключить заново",
      env_missing: "платформа настраивается",
      provider_setup_required: "нужна настройка провайдера",
      platform_configuring: "платформа настраивается",
      ready_to_connect: "готово к подключению",
      blocked_missing_credentials: "платформа настраивается",
      blocked_provider_dashboard_check: "нужна проверка платформы",
      blocked_authorize_url: "подключение временно закрыто",
      blocked_public_disabled: "подключение временно закрыто",
      missing_env: "платформа настраивается",
      not_checked: "не проверено",
      not_recorded: "не записывается",
      api_error: "ошибка API",
      needs_setup: "нужна настройка",
      degraded: "частично работает",
    }[status] || status || "неизвестно";
  }

  function providerLabel(provider) {
    return {
      meta_ads: "Meta Ads",
      google_ads: "Google Ads",
      google_search_console: "Google Search Console",
      tiktok_ads: "TikTok Ads",
      yandex_direct: "Yandex Direct",
    }[provider] || provider;
  }

  /* ---------- small renderers ---------- */

  function badge(text, tone) {
    return `<span class="badge badge--${tone}">${esc(text)}</span>`;
  }

  function statusBadgeMarkup(text, tone) {
    return `<span class="badge badge--${escAttr(tone)}">${esc(text)}</span>`;
  }

  function kvGrid(rows) {
    return `<div class="kv">${rows.map(([k, v]) => `<div class="kv-row"><span>${esc(k)}</span><strong>${v}</strong></div>`).join("")}</div>`;
  }

  function boolValue(value, expected) {
    const text = value === true ? "да" : value === false ? "нет" : "—";
    let cls = "";
    if (expected !== undefined && value !== undefined) cls = value === expected ? "kv-ok" : "kv-err";
    return `<span class="${cls}">${text}</span>`;
  }

  function statusValue(status) {
    const good = ["ok", "ready", "mcp_ready"].includes(status);
    const bad = ["api_error", "error", "degraded"].includes(status);
    const cls = good ? "kv-ok" : bad ? "kv-err" : "kv-warn";
    return `<span class="${cls}">${esc(statusLabel(status))}</span>`;
  }

  function noticeMarkup(text, tone) {
    return `<div class="notice notice--${escAttr(tone || "info")}">${esc(text)}</div>`;
  }

  function emptyState(text) {
    return `<div class="empty-state"><p>${esc(text)}</p></div>`;
  }

  function errorState(text) {
    return `<div class="empty-state empty-state--error"><p>${esc(text)}</p></div>`;
  }

  /* ---------- network ---------- */

  async function api(path, method = "GET", body) {
    const headers = { Accept: "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    if (body && !isFormData) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        const err = new Error(text);
        err.status = response.status;
        throw err;
      }
    }
    if (!response.ok) {
      const err = new Error(payload.error || payload.message || `HTTP ${response.status}`);
      err.status = response.status;
      err.code = payload.code;
      throw err;
    }
    return payload;
  }

  function handle401(error) {
    if (error && error.status === 401) {
      clearToken();
      state.capabilities = null;
      state.connections = null;
      if (state.user) {
        state.user = null;
        showLanding();
        openAuth("login");
        showAuthError("Сессия истекла. Войдите ещё раз, чтобы продолжить работу в кабинете.");
      } else {
        showGate("Сессия истекла или код доступа неверный. Введите код доступа еще раз.");
      }
      return true;
    }
    return false;
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function setToken(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      /* ignore */
    }
  }

  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  /* ---------- utilities ---------- */

  function humanizeError(error) {
    const text = String(error?.message || error || "").trim();
    const lower = text.toLowerCase();
    if (!text) return "Что-то пошло не так. Попробуйте еще раз.";
    if (lower.includes("api_auth_not_configured") || lower.includes("ad_mcp_web_api_token")) {
      return "Код доступа еще не настроен на сервере. Обратитесь к менеджеру HolyMedia.";
    }
    if (lower.includes("api_auth_required") || lower.includes("beta token")) {
      return "Нужен корректный код доступа.";
    }
    if (lower.includes("not configured") && lower.includes("oauth")) {
      return "Платформа временно настраивается. Обратитесь к менеджеру HolyMedia, если подключение нужно ускорить.";
    }
    if (lower.includes("state expired") || (lower.includes("pending") && lower.includes("expired"))) {
      return "Сессия OAuth истекла. Переподключите платформу.";
    }
    if (lower.includes("no ad accounts") || lower.includes("no accessible")) {
      return "Авторизация прошла, но провайдер не вернул доступные рекламные аккаунты.";
    }
    if (lower.includes("refresh_token")) {
      return "OAuth не вернул refresh token. Переподключите платформу с подтверждением доступа.";
    }
    if (text.length > 240) return `${text.slice(0, 237)}…`;
    return text;
  }

  function normalizeGoogleCustomerId(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function formatTime(value) {
    if (!value) return "—";
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    } catch (error) {
      return String(value);
    }
  }

  function formatNumber(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0";
    return number.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }

  function formatPercent(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0%";
    return `${(number * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
  }

  function pluralRu(count, one, few, many) {
    const number = Math.abs(Number(count || 0));
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (error) {
      /* fall through */
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch (error) {
      /* ignore */
    }
    area.remove();
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
  }

  function cleanUrl() {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  function markMcpUrlCopied() {
    state.mcpUrlCopied = true;
    localStorage.setItem(MCP_URL_COPIED_KEY, "1");
    if (state.section === "overview" && state.capabilities && state.connections) {
      renderOverview(state.capabilities, state.connections);
    }
  }

  function showClientMessage(title, message, tone = "info") {
    showClientModal({
      title,
      subtitle: message,
      body: "",
      tone,
      closeLabel: "Понятно",
    });
  }

  function showClientModal({ title, subtitle = "", body = "", tone = "info", closeLabel = "Понятно" }) {
    if (!el.clientModal) return;
    el.clientModal.dataset.tone = tone;
    el.clientModalTitle.textContent = title;
    el.clientModalSubtitle.textContent = subtitle;
    el.clientModalSubtitle.hidden = !subtitle;
    el.clientModalBody.innerHTML = body || "";
    el.clientModalActions.innerHTML = closeLabel
      ? `<button type="button" class="btn btn--primary" data-client-modal-close>${esc(closeLabel)}</button>`
      : "";
    el.clientModalActions.querySelectorAll("[data-client-modal-close]").forEach((node) => {
      node.addEventListener("click", () => closeClientModal());
    });
    if (el.clientModal.hidden) state.clientModalReturnFocus = document.activeElement;
    el.clientModal.hidden = false;
    window.setTimeout(() => {
      const panel = el.clientModal.querySelector(".modal__panel");
      const target = panel?.querySelector("input, select, textarea, .btn--primary, button:not(.modal__close)");
      (target || panel?.querySelector("button"))?.focus();
    }, 0);
  }

  function closeClientModal() {
    if (!el.clientModal) return;
    if (state.pendingModalId && state.activePending?.pending_id === state.pendingModalId) {
      rememberDismissedPending(state.pendingModalId);
      state.activePending = null;
      state.pendingModalId = null;
    }
    const wasOpen = !el.clientModal.hidden;
    el.clientModal.hidden = true;
    el.clientModalBody.innerHTML = "";
    el.clientModalActions.innerHTML = "";
    if (wasOpen && state.clientModalReturnFocus?.focus && document.contains(state.clientModalReturnFocus)) {
      state.clientModalReturnFocus.focus();
    }
    state.clientModalReturnFocus = null;
  }

  function toast(message, tone = "info") {
    if (!el.toastRoot) return;
    const item = document.createElement("div");
    item.className = `toast toast--${tone}`;
    item.textContent = message;
    el.toastRoot.appendChild(item);
    window.setTimeout(() => {
      item.classList.add("is-hidden");
      window.setTimeout(() => item.remove(), 220);
    }, 2600);
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escAttr(value) {
    return esc(value);
  }
})();

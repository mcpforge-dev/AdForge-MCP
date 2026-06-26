/* HolyMedia MCP hosted beta dashboard.
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
    tiktok_ads: "tiktok",
    yandex_direct: "yandex",
  };

  const PROVIDER_DESC = {
    meta_ads: "Кампании, статусы, бюджеты и базовые метрики из Meta Ads.",
    google_ads: "Кампании, статусы, бюджеты и базовые метрики из Google Ads.",
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
    el.siteAnalysisForm = document.getElementById("site-analysis-form");
    el.siteAnalysisUrl = document.getElementById("site-analysis-url");
    el.siteAnalysisSubmit = document.getElementById("site-analysis-submit");
    el.siteAnalysisResult = document.getElementById("site-analysis-result");
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
  }

  function bindAuth() {
    document.querySelectorAll("[data-auth-close]").forEach((node) => {
      node.addEventListener("click", () => closeAuth());
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !el.authModal.hidden) closeAuth();
      if (event.key === "Escape" && el.clientModal && !el.clientModal.hidden) closeClientModal();
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

  function openAuth(mode) {
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
    el.authModal.hidden = true;
    hideAuthError();
    el.authForm.reset();
    el.authForm.hidden = false;
    el.authSuccess.hidden = true;
    resetPasswordVisibility();
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
      ? "Создайте аккаунт, чтобы подключить рекламные кабинеты и получить MCP доступ."
      : "Введите email и пароль, чтобы открыть личный кабинет.";
    el.authSubmit.textContent = isRegister ? "Зарегистрироваться" : "Войти";
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
        }, 900);
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
    el.diagRun.addEventListener("click", () => runDiagnostics());
    if (el.siteAnalysisForm) {
      el.siteAnalysisForm.addEventListener("submit", runSiteAnalysis);
    }
    document.querySelectorAll("[data-client-modal-close]").forEach((node) => {
      node.addEventListener("click", () => closeClientModal());
    });
    el.copyMcpUrl.addEventListener("click", async () => {
      const url = el.mcpUrl.textContent.trim();
      if (!url || url === "—") return;
      await copyText(url);
      markMcpUrlCopied();
      showClientMessage("MCP URL скопирован", "Теперь перейдите в раздел MCP и выберите инструкцию для Codex, Claude или ChatGPT.", "success");
    });
    el.copyMcpUrlPanel.addEventListener("click", async () => {
      const url = el.mcpUrlPanel.textContent.trim();
      if (!url || url === "—") return;
      await copyText(url);
      markMcpUrlCopied();
      showClientMessage("MCP URL скопирован", "Вставьте этот URL при добавлении remote MCP server в Codex, Claude или ChatGPT.", "success");
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
      showClientMessage("Bearer значение скопировано", "В AI-клиенте добавьте Header: Name Authorization, Value Bearer + ваш ключ доступа.", "success");
    });
    if (el.copyMcpOAuthClientId) {
      el.copyMcpOAuthClientId.addEventListener("click", async () => {
        const value = el.mcpOAuthClientId.textContent.trim();
        if (!value) return;
        await copyText(value);
        showClientMessage("OAuth Client ID скопирован", "Вставьте его в Advanced settings Claude.", "success");
      });
    }
    if (el.copyMcpOAuthClientSecret) {
      el.copyMcpOAuthClientSecret.addEventListener("click", async () => {
        const value = el.mcpOAuthClientSecret.textContent.trim();
        if (!value) return;
        await copyText(value);
        showClientMessage("OAuth Client Secret скопирован", "Вставьте его в Advanced settings Claude. Secret показывается только один раз.", "success");
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
      /* beta fallback may not have a web session */
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
      title: isRegister ? "Добро пожаловать в HolyMedia MCP" : "С возвращением в HolyMedia MCP",
      subtitle: isRegister
        ? "Первый шаг простой: подключите рекламную платформу, выберите кабинеты и скопируйте MCP URL для AI-клиента."
        : "Кабинет готов к работе. Можно перейти к подключениям или продолжить с текущего раздела.",
      body: `
        <div class="welcome-card">
          <strong>${isRegister ? "Что сделать дальше" : "Быстрый старт"}</strong>
          <span>${isRegister ? "Подключите Meta, Google, TikTok или Yandex, затем добавьте HolyMedia MCP в Codex, Claude или ChatGPT." : "Если нужно проверить кабинеты, откройте раздел подключений. Все опасные действия остаются в безопасном preview-режиме."}</span>
        </div>
      `,
      closeLabel: "",
    });
    el.clientModalActions.innerHTML = `
      <button type="button" class="btn btn--primary" data-welcome-connections>Перейти к подключениям</button>
      <button type="button" class="btn btn--secondary" data-client-modal-close>Продолжить работу</button>
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
    if (state.section === "diagnostics" && !state.diagnosticsRun) {
      el.diagnosticsContent.innerHTML = emptyState("Запустите диагностику, чтобы увидеть состояние сервиса.");
    }
    if (state.section === "profile") loadProfile();
  }

  function applyPreviewBadge(capabilities) {
    const enabled = capabilities?.preview_only?.enabled !== false;
    el.previewBadge.textContent = enabled ? "Безопасный режим включён" : "Безопасный режим выключен";
    el.previewBadge.className = `badge ${enabled ? "badge--ok" : "badge--err"}`;
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
    el.mcpTokenStatus.innerHTML = emptyState("Загружаем статус token...");
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
        <h3 class="card__title">Beta fallback</h3>
        <p class="card__hint">Вы вошли по старому коду доступа. Email-профиль появится после входа или регистрации.</p>
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
          <p class="card__hint">Нажмите на аватар, чтобы загрузить фото. Никнейм и пароль можно изменить ниже.</p>
          <span class="profile-avatar__hint">JPG, PNG или WEBP до 2 MB.</span>
        </div>
      </form>
      <div class="grid-2 profile-grid">
        <form id="profile-form" class="card-lite">
          <h3 class="card__title">Профиль</h3>
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
        <div class="card-lite profile-password-form">
          <h3 class="card__title">Пароль</h3>
          <p class="card__hint">Поля смены пароля открываются отдельно, чтобы профиль оставался аккуратным.</p>
          <button id="open-change-password" type="button" class="btn btn--secondary btn--small">Сменить пароль</button>
        </div>
      </div>
    `;
    bindProfileForms();
  }

  async function loadMcpOAuthClient() {
    if (!el.mcpOAuthClientStatus) return;
    el.mcpOAuthClientReveal.hidden = true;
    el.mcpOAuthClientId.textContent = "";
    el.mcpOAuthClientSecret.textContent = "";
    el.mcpOAuthClientStatus.innerHTML = emptyState("Загружаем Claude OAuth credentials...");
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
        <strong>Claude OAuth credentials</strong>
        <span>Войдите по email, чтобы создать OAuth Client ID/Secret для Claude.</span>
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
      <strong>Claude OAuth credentials</strong>
      <div class="kv">
        <div class="kv-row"><span>Статус</span><strong>${statusBadgeMarkup(active ? "Активен" : exists ? "Отозван" : "Не создан", active ? "ok" : exists ? "warn" : "muted")}</strong></div>
        <div class="kv-row"><span>Client ID</span><strong class="mono">${esc(client?.client_id || "—")}</strong></div>
        <div class="kv-row"><span>Secret prefix</span><strong class="mono">${esc(client?.client_secret_prefix || "—")}</strong></div>
      </div>
      <span>Если Claude зависает на Checking connection, создайте эти значения и вставьте их в Advanced settings.</span>
    `;
    el.mcpOAuthClientActions.innerHTML = `
      <button type="button" class="btn btn--primary btn--small" data-mcp-oauth-client-action="create">${active ? "Сгенерировать новый OAuth Secret" : "Создать OAuth Client ID/Secret"}</button>
    `;
    el.mcpOAuthClientActions.querySelector("[data-mcp-oauth-client-action]").addEventListener("click", (event) => runMcpOAuthClientAction(event.currentTarget));
  }

  async function runMcpOAuthClientAction(button) {
    if (state.mcpOAuthClient?.exists && !window.confirm("Сгенерировать новый Claude OAuth Client ID/Secret? Старый secret перестанет работать.")) return;
    setLoading(button, true);
    try {
      const payload = await api("/api/mcp-oauth-client/create", "POST", {});
      state.mcpOAuthClient = payload.client || null;
      renderMcpOAuthClientStatus(state.mcpOAuthClient);
      el.mcpOAuthClientId.textContent = state.mcpOAuthClient?.client_id || "";
      el.mcpOAuthClientSecret.textContent = payload.client_secret || "";
      el.mcpOAuthClientReveal.hidden = false;
      showClientMessage("Claude OAuth credentials созданы", "Скопируйте Client ID и Client Secret сейчас: secret показывается только один раз.", "success");
    } catch (error) {
      if (handle401(error)) return;
      showClientMessage("Не удалось создать Claude OAuth credentials", humanizeError(error), "error");
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
    el.overviewStats.innerHTML = emptyState("Загружаем статус...");
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
      el.overviewStats.innerHTML = errorState(humanizeError(error));
    }
  }

  function renderOverview(capabilities, connections) {
    const platforms = connections.platforms || [];
    const connectedPlatforms = platforms.filter((p) => (p.accounts || []).length > 0);
    const connectedAccounts = connectedPlatforms.reduce((sum, p) => sum + (p.accounts || []).length, 0);
    const mcpUrl = capabilities?.mcp?.url || connections?.mcp?.url || "";
    const previewOn = capabilities?.preview_only?.enabled !== false;

    el.mcpUrl.textContent = mcpUrl || "—";
    el.copyMcpUrl.disabled = !mcpUrl;
    if (el.mcpUrlPanel) {
      el.mcpUrlPanel.textContent = mcpUrl || "—";
      el.copyMcpUrlPanel.disabled = !mcpUrl;
    }

    const stats = [
      stat("Сервис", badge("Работает", "ok")),
      stat("Адрес кабинета", monoText(window.location.origin)),
      stat("Безопасный режим", badge(previewOn ? "включён" : "выключен", previewOn ? "ok" : "err")),
      stat("Подключенные платформы", String(connectedPlatforms.length)),
      stat("Рекламные аккаунты", String(connectedAccounts)),
      stat("AI-подключение", state.mcpUrlCopied ? badge("URL скопирован", "ok") : badge("Ожидает настройки", "info")),
    ];
    el.overviewStats.innerHTML = stats.join("");

    el.overviewNotice.innerHTML = state.notice ? noticeMarkup(state.notice.text, state.notice.tone) : "";

    const steps = [
      { text: "Подключите рекламную платформу", done: connectedPlatforms.length > 0 || hasPending(platforms) },
      { text: "Выберите рекламные аккаунты", done: connectedAccounts > 0 },
      { text: "Скопируйте MCP URL", done: state.mcpUrlCopied },
      { text: "Подключите HolyMedia MCP в Codex, Claude или ChatGPT", done: false },
      { text: "Перезапустите MCP / откройте новый чат", done: false },
      { text: "Задайте AI первый вопрос по аккаунтам, кампаниям или метрикам", done: false },
    ];
    el.nextSteps.innerHTML = steps
      .map((s) => `<li class="${s.done ? "is-done" : ""}">${esc(s.text)}</li>`)
      .join("");
  }

  function hasPending(platforms) {
    return platforms.some((p) => (p.pending_selections || []).some((x) => x.status === "pending_account_selection"));
  }

  async function runSiteAnalysis(event) {
    event.preventDefault();
    const url = el.siteAnalysisUrl.value.trim();
    if (!url) return;
    setLoading(el.siteAnalysisSubmit, true);
    el.siteAnalysisResult.hidden = false;
    el.siteAnalysisResult.innerHTML = emptyState("Анализируем сайт...");
    try {
      const payload = await api("/api/site/analyze", "POST", { url });
      renderSiteAnalysis(payload.analysis || null);
    } catch (error) {
      if (handle401(error)) return;
      el.siteAnalysisResult.innerHTML = errorState(humanizeError(error));
    } finally {
      setLoading(el.siteAnalysisSubmit, false);
    }
  }

  function renderSiteAnalysis(analysis) {
    if (!analysis) {
      el.siteAnalysisResult.innerHTML = errorState("Не удалось получить результат анализа.");
      return;
    }
    const recommendations = analysis.priority_recommendations || [];
    const summary = analysis.status === "ok"
      ? analysis.summary || "Готово. Ниже приоритетные улучшения."
      : analysis.error || analysis.summary || "Не удалось выполнить анализ сайта.";
    el.siteAnalysisResult.innerHTML = `
      <p class="site-analysis-result__summary">${esc(summary)}</p>
      <ol class="site-analysis-list">
        ${recommendations.slice(0, 6).map((item) => `
          <li>
            <small>${esc(item.area || "Рекомендация")} · ${esc(priorityLabel(item.priority))}</small><br>
            ${esc(item.recommendation || "")}
          </li>
        `).join("")}
      </ol>
    `;
  }

  function priorityLabel(priority) {
    const value = String(priority || "").toLowerCase();
    if (value === "high") return "высокий приоритет";
    if (value === "medium") return "средний приоритет";
    if (value === "low") return "низкий приоритет";
    return "приоритет";
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
        <div class="platform-card__meta">${metaBits.join("")}</div>
        <p class="platform-card__hint">${esc(statusHint(status, canConnect))}</p>
        ${status === "provider_setup_required" ? renderProviderSetupCallout(platform) : ""}
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
    if (accounts.length) {
      return [`<span>Подключено аккаунтов <strong>${accounts.length}</strong></span>`];
    }
    if (status === "select_accounts") {
      const pending = (platform.pending_selections || []).find((x) => x.status === "pending_account_selection");
      const count = (pending?.accounts || []).length;
      return [`<span>Найдено аккаунтов <strong>${count}</strong></span>`];
    }
    if (status === "ready_to_connect") return [`<span>Состояние <strong>готово к подключению</strong></span>`];
    if (status === "reconnect_required") return [`<span>Состояние <strong>нужно подключить заново</strong></span>`];
    if (status === "provider_setup_required" || status === "credentials_missing") {
      return [`<span>Состояние <strong>платформа настраивается</strong></span>`];
    }
    return [`<span>Состояние <strong>${esc(statusLabel(status))}</strong></span>`];
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

  function renderProviderSetupCallout(platform) {
    return `
      <div class="callout callout--warn">
        <strong>Платформа настраивается</strong>
        <span>Мы готовим подключение этой платформы. Как только настройка будет завершена, кнопка подключения станет доступна.</span>
      </div>
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
    const meta = pending?.metadata || {};
    if (pending.provider === "google_ads" && Object.keys(meta).length) {
      const blocked = meta.accessible_customers_status === "blocked";
      const detail = meta.provider_api_error ? `<small>${esc(meta.provider_api_error)}</small>` : "";
      return `
        <div class="pending-diagnostics">
          <strong>Диагностика Google Ads</strong>
          <span>${blocked ? "Google OAuth прошёл, но API не вернул список кабинетов автоматически." : "Google Ads API вернул список доступных кабинетов."}</span>
          ${blocked ? "<span>Можно завершить подключение вручную: введите Customer ID рекламного кабинета.</span>" : ""}
          ${detail}
        </div>
      `;
    }
    if (pending.provider !== "yandex_direct" || !Object.keys(meta).length) return "";
    const returned = Number(meta.api_clients_returned ?? 0);
    const archived = Number(meta.archived_clients ?? 0);
    const active = Number(meta.active_clients ?? Math.max(0, returned - archived));
    const fallback = meta.fallback_used === true || meta.fallback_used === "true";
    return `
      <div class="pending-diagnostics">
        <strong>Диагностика Yandex Direct</strong>
        <span>API вернул клиентов: ${esc(returned)}</span>
        <span>Активных: ${esc(active)}</span>
        <span>Архивных/отключённых: ${esc(archived)}</span>
        <span>Fallback использован: ${fallback ? "да" : "нет"}</span>
        ${returned === 0 && !fallback ? `<small>Yandex API не вернул кабинеты. Проверьте права пользователя или агентский доступ в Yandex Direct.</small>` : ""}
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
    const map = {
      connected: ["Подключено", "ok"],
      ready_to_connect: ["Не подключено", "info"],
      select_accounts: ["Выберите аккаунт", "warn"],
      reconnect_required: ["Нужно подключить заново", "warn"],
      provider_setup_required: ["Платформа настраивается", "warn"],
      credentials_missing: ["Платформа настраивается", "muted"],
      error: ["Ошибка подключения", "err"],
    };
    const [label, tone] = map[status] || ["Статус неизвестен", "muted"];
    const modeChip = testMode ? `<span class="badge badge--info">Тестовый режим</span>` : "";
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
      blocked_provider_dashboard_check: "нужна проверка provider dashboard",
      blocked_authorize_url: "authorize URL заблокирован",
      blocked_public_disabled: "public OAuth выключен",
      missing_env: "платформа настраивается",
      not_checked: "не проверено",
      not_recorded: "не записывается",
      api_error: "ошибка API",
      needs_setup: "нужна настройка",
      degraded: "частично работает",
    }[status] || status || "неизвестно";
  }

  function providerLabel(provider) {
    return { meta_ads: "Meta Ads", google_ads: "Google Ads", tiktok_ads: "TikTok Ads", yandex_direct: "Yandex Direct" }[provider] || provider;
  }

  /* ---------- small renderers ---------- */

  function stat(label, valueHtml) {
    return `<div class="stat"><span class="stat__label">${esc(label)}</span><span class="stat__value">${valueHtml}</span></div>`;
  }

  function badge(text, tone) {
    return `<span class="badge badge--${tone}">${esc(text)}</span>`;
  }

  function statusBadgeMarkup(text, tone) {
    return `<span class="badge badge--${escAttr(tone)}">${esc(text)}</span>`;
  }

  function monoText(value) {
    return `<span class="mono">${esc(value)}</span>`;
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
    return `<div class="empty-state"><p>${esc(text)}</p></div>`;
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
    el.clientModal.hidden = false;
  }

  function closeClientModal() {
    if (!el.clientModal) return;
    if (state.pendingModalId && state.activePending?.pending_id === state.pendingModalId) {
      rememberDismissedPending(state.pendingModalId);
      state.activePending = null;
      state.pendingModalId = null;
    }
    el.clientModal.hidden = true;
    el.clientModalBody.innerHTML = "";
    el.clientModalActions.innerHTML = "";
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

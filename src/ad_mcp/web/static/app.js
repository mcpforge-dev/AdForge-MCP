/* AdForge MCP hosted beta dashboard.
   Onboarding flow: access code gate -> onboarding -> connections -> diagnostics.
   Uses only existing hosted/diagnostics endpoints. Never renders the access code
   or provider secrets. */
(function () {
  "use strict";

  const TOKEN_KEY = "ad_mcp_web_api_token";

  const PROVIDER_SLUG = {
    meta_ads: "meta",
    google_ads: "google",
    tiktok_ads: "tiktok",
    yandex_direct: "yandex",
  };

  const PROVIDER_DESC = {
    meta_ads: "Кампании, статусы, бюджеты и базовые метрики из Meta Ads.",
    google_ads: "Кампании, статусы, бюджеты и базовые метрики из Google Ads.",
    tiktok_ads: "Ограниченная beta-поддержка: подключение готовится, чтение кампаний может быть недоступно.",
    yandex_direct: "Ограниченная beta-поддержка: подключение готовится, чтение кампаний может быть недоступно.",
  };

  const LIMITED_BETA = new Set(["tiktok_ads", "yandex_direct"]);

  const state = {
    section: "overview",
    authMode: "login",
    user: null,
    capabilities: null,
    connections: null,
    activePending: null,
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
    el.authTitle = document.getElementById("auth-title");
    el.authSubtitle = document.getElementById("auth-subtitle");
    el.authSubmit = document.getElementById("auth-submit");
    el.authError = document.getElementById("auth-error");
    el.authTabs = Array.from(document.querySelectorAll("[data-auth-mode]"));
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
    el.nextSteps = document.getElementById("next-steps");
    el.mcpUrl = document.getElementById("mcp-url");
    el.copyMcpUrl = document.getElementById("copy-mcp-url");
    el.mcpUrlPanel = document.getElementById("mcp-url-panel");
    el.copyMcpUrlPanel = document.getElementById("copy-mcp-url-panel");
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
    if (window.location.pathname === "/admin") {
      enterAdmin();
      return;
    }
    if (window.location.pathname === "/" && !getToken()) {
      try {
        const me = await api("/api/auth/me");
        if (me.authenticated) {
          state.user = me.user;
          await loadCapabilities();
          enterApp();
          return;
        }
      } catch (error) {
        /* public landing remains visible */
      }
      showLanding();
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
    el.authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));
    el.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = {
        email: el.authEmail.value.trim(),
        password: el.authPassword.value,
      };
      if (state.authMode === "register") payload.name = el.authName.value.trim();
      setLoading(el.authSubmit, true);
      hideAuthError();
      try {
        const result = await api(`/api/auth/${state.authMode}`, "POST", payload);
        state.user = result.user || null;
        closeAuth();
        if (window.location.pathname === "/admin") {
          enterAdmin();
          return;
        }
        await loadCapabilities();
        window.history.replaceState({}, "", "/app");
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
    window.setTimeout(() => {
      const target = state.authMode === "register" ? el.authName : el.authEmail;
      target.focus();
    }, 0);
  }

  function closeAuth() {
    el.authModal.hidden = true;
  }

  function setAuthMode(mode) {
    state.authMode = mode === "register" ? "register" : "login";
    el.authTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.authMode === state.authMode));
    const isRegister = state.authMode === "register";
    el.authNameField.hidden = !isRegister;
    el.authName.required = isRegister;
    el.authPassword.autocomplete = isRegister ? "new-password" : "current-password";
    el.authTitle.textContent = isRegister ? "Создать аккаунт" : "Войти в AdForge MCP";
    el.authSubtitle.textContent = isRegister
      ? "Создайте аккаунт, чтобы подключить рекламные кабинеты и получить MCP доступ."
      : "Введите email и пароль, чтобы открыть личный кабинет.";
    el.authSubmit.textContent = isRegister ? "Зарегистрироваться" : "Войти";
  }

  function showAuthError(message) {
    el.authError.textContent = message;
    el.authError.hidden = false;
  }

  function hideAuthError() {
    el.authError.hidden = true;
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
    el.connectionsRefresh.addEventListener("click", () => loadConnections());
    el.diagRun.addEventListener("click", () => runDiagnostics());
    el.copyMcpUrl.addEventListener("click", async () => {
      const url = el.mcpUrl.textContent.trim();
      if (!url || url === "—") return;
      await copyText(url);
      toast("MCP URL скопирован.", "success");
    });
    el.copyMcpUrlPanel.addEventListener("click", async () => {
      const url = el.mcpUrlPanel.textContent.trim();
      if (!url || url === "—") return;
      await copyText(url);
      toast("MCP URL скопирован.", "success");
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
    } else if (pendingId && returnedProvider) {
      state.notice = { tone: "info", text: "Авторизация завершена. Выберите рекламные аккаунты, которые сможет использовать AdForge MCP." };
    }
    cleanUrl();
    if (pendingId && returnedProvider) {
      setSection("connections");
      loadConnections().then(() => loadPending(returnedProvider, pendingId));
      return;
    }
    setSection(requested && isKnownSection(requested) ? requested : "overview");
  }

  function isKnownSection(section) {
    return el.navTabs.some((tab) => tab.dataset.nav === section);
  }

  function setSection(section) {
    state.section = isKnownSection(section) ? section : "overview";
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
    if (state.section === "profile") renderProfile();
  }

  function applyPreviewBadge(capabilities) {
    const enabled = capabilities?.preview_only?.enabled !== false;
    el.previewBadge.textContent = enabled ? "Preview-only: включено" : "Preview-only: выключено";
    el.previewBadge.className = `badge ${enabled ? "badge--ok" : "badge--err"}`;
  }

  function renderMcpPanel() {
    const mcpUrl = state.capabilities?.mcp?.url || state.connections?.mcp?.url || "";
    el.mcpUrlPanel.textContent = mcpUrl || "—";
    el.copyMcpUrlPanel.disabled = !mcpUrl;
  }

  function renderProfile() {
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
    el.profileCard.innerHTML = `
      <div class="kv">
        <div class="kv-row"><span>Имя</span><strong>${esc(user.name || "—")}</strong></div>
        <div class="kv-row"><span>Email</span><strong>${esc(user.email)}</strong></div>
        <div class="kv-row"><span>Роль</span><strong>${esc(user.role)}</strong></div>
        <div class="kv-row"><span>Статус</span><strong>${esc(user.status)}</strong></div>
        <div class="kv-row"><span>Workspace</span><strong class="mono">${esc(user.workspace_id || "—")}</strong></div>
      </div>
    `;
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
      stat("Сервис", badge("Hosted beta · live", "ok")),
      stat("Live URL", monoText(window.location.origin)),
      stat("Preview-only", badge(previewOn ? "включено" : "выключено", previewOn ? "ok" : "err")),
      stat("Подключенные платформы", String(connectedPlatforms.length)),
      stat("Рекламные аккаунты", String(connectedAccounts)),
      stat("MCP tools", String((capabilities?.mcp?.tools || []).length || "—")),
    ];
    el.overviewStats.innerHTML = stats.join("");

    el.overviewNotice.innerHTML = state.notice ? noticeMarkup(state.notice.text, state.notice.tone) : "";

    const steps = [
      { text: "Подключите рекламную платформу", done: connectedPlatforms.length > 0 || hasPending(platforms) },
      { text: "Выберите рекламные аккаунты", done: connectedAccounts > 0 },
      { text: "Проверьте диагностику", done: state.diagnosticsRun },
      { text: "Скопируйте MCP URL", done: false },
      { text: "Добавьте его в Codex / Claude как внешний MCP-сервер", done: false },
      { text: "Задайте AI первый вопрос по аккаунтам, кампаниям или метрикам", done: false },
    ];
    el.nextSteps.innerHTML = steps
      .map((s) => `<li class="${s.done ? "is-done" : ""}">${esc(s.text)}</li>`)
      .join("");
  }

  function hasPending(platforms) {
    return platforms.some((p) => (p.pending_selections || []).some((x) => x.status === "pending_account_selection"));
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
    el.pendingPanel.innerHTML = state.activePending ? renderPendingPanel(state.activePending) : "";
    const platforms = (connections && connections.platforms) || [];
    el.connectionsList.innerHTML = platforms.length
      ? platforms.map(renderPlatformCard).join("")
      : emptyState("Пока нет подключенных рекламных аккаунтов. Начните с подключения рекламной платформы.");
    bindConnectionActions();
  }

  function renderPlatformCard(platform) {
    const status = resolveStatus(platform);
    const accounts = platform.accounts || [];
    const summary = platform.diagnostic_summary || {};
    const limited = LIMITED_BETA.has(platform.provider);
    const canConnect = Boolean(platform.oauth_configured);
    const connectLabel = !canConnect ? "Скоро доступно" : status === "connected" ? "Переподключить" : "Подключить";

    const metaBits = [
      `<span>Статус <strong>${canConnect ? "доступно" : "настраивается"}</strong></span>`,
      `<span>Аккаунты <strong>${accounts.length}</strong></span>`,
    ];
    if (summary.last_successful_update) {
      metaBits.push(`<span>Последняя проверка <strong>${esc(formatTime(summary.last_successful_update))}</strong></span>`);
    }

    const accountsBlock = accounts.length
      ? `<div class="platform-card__accounts">${accounts.map(renderAccountRow).join("")}</div>`
      : "";

    const pending = (platform.pending_selections || []).find((x) => x.status === "pending_account_selection");
    const expired = (platform.pending_selections || []).find((x) => x.status === "expired");

    return `
      <article class="card platform-card">
        <div class="platform-card__head">
          <div>
            <h3 class="platform-card__name">${esc(platform.label || platform.provider)}</h3>
            <p class="platform-card__desc">${esc(PROVIDER_DESC[platform.provider] || "")}</p>
          </div>
          ${statusBadge(status, limited)}
        </div>
        <div class="platform-card__meta">${metaBits.join("")}</div>
        <p class="platform-card__hint">${esc(statusHint(status, canConnect))}</p>
        ${accountsBlock}
        ${pending ? renderPendingCallout(platform, pending) : ""}
        ${expired && !pending ? renderExpiredCallout() : ""}
        <div class="platform-card__actions">
          <button type="button" class="btn btn--primary btn--small" data-oauth="${escAttr(platform.provider)}" ${canConnect ? "" : "disabled"}>${connectLabel}</button>
          <button type="button" class="btn btn--secondary btn--small" data-diag="${escAttr(platform.provider)}">Проверить статус</button>
          ${accounts.length ? `<button type="button" class="btn btn--danger btn--small" data-disconnect="${escAttr(platform.provider)}">Отключить</button>` : ""}
        </div>
      </article>
    `;
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

  function renderPendingCallout(platform, pending) {
    const count = (pending.accounts || []).length;
    return `
      <div class="callout">
        <strong>Нужно выбрать рекламные аккаунты</strong>
        <span>OAuth нашел аккаунты: ${count}. Выберите, какие аккаунты сможет использовать AdForge MCP.</span>
        <button type="button" class="btn btn--secondary btn--small" data-pending="${escAttr(platform.provider)}" data-pending-id="${escAttr(pending.pending_id)}">Выбрать аккаунты</button>
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
    const options = accounts.length
      ? accounts.map(renderPendingOption).join("")
      : emptyState("Провайдер не вернул рекламные аккаунты.");
    return `
      <article class="card pending-card">
        <h3 class="card__title">Выберите аккаунты · ${esc(providerLabel(pending.provider))}</h3>
        <p class="card__hint">Отметьте рекламные аккаунты, которые сможет использовать AdForge MCP. Секреты хранятся только на сервере и не показываются в интерфейсе.</p>
        <form id="pending-form" data-provider="${escAttr(pending.provider)}">
          <div class="pending-list">${options}</div>
          <div class="pending-actions">
            <button type="submit" class="btn btn--primary btn--small" ${accounts.length ? "" : "disabled"}>Сохранить выбранные аккаунты</button>
            <button type="button" class="btn btn--ghost btn--small" data-cancel-pending>Отмена</button>
          </div>
        </form>
      </article>
    `;
  }

  function renderPendingOption(account) {
    const id = account.account_id || account.customer_id || account.advertiser_id || account.direct_client_login || "";
    return `
      <label class="pending-option">
        <input type="checkbox" name="account_id" value="${escAttr(id)}" checked>
        <span>
          <span class="pending-option__name">${esc(account.name || id || "Аккаунт")}</span>
          <span class="pending-option__id">${esc(id)}</span>
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
    const form = el.pendingPanel.querySelector("#pending-form");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        savePending(form.dataset.provider, form, event.submitter);
      });
      const cancel = el.pendingPanel.querySelector("[data-cancel-pending]");
      if (cancel) {
        cancel.addEventListener("click", () => {
          state.activePending = null;
          renderConnections(state.connections);
        });
      }
    }
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
      toast(humanizeError(error), "error");
    }
  }

  async function loadPending(provider, pendingId) {
    const slug = PROVIDER_SLUG[provider];
    if (!slug || !pendingId) return;
    try {
      state.activePending = await api(`/api/hosted/oauth/${slug}/pending?pending_id=${encodeURIComponent(pendingId)}`);
      state.notice = { tone: "info", text: "Выберите один или несколько аккаунтов и сохраните подключение." };
      if (!state.connections) state.connections = await api("/api/hosted/connections");
      renderConnections(state.connections);
    } catch (error) {
      if (handle401(error)) return;
      state.activePending = null;
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
    }
  }

  async function savePending(provider, form, button) {
    const slug = PROVIDER_SLUG[provider];
    if (!slug || !state.activePending) return;
    const accountIds = Array.from(form.querySelectorAll("input[name='account_id']:checked")).map((i) => i.value);
    if (!accountIds.length) {
      toast("Выберите хотя бы один аккаунт.", "info");
      return;
    }
    setLoading(button, true);
    try {
      await api(`/api/hosted/oauth/${slug}/select`, "POST", {
        pending_id: state.activePending.pending_id,
        account_ids: accountIds,
      });
      state.activePending = null;
      state.notice = { tone: "success", text: "Аккаунты подключены. MCP tools теперь могут использовать эту платформу." };
      await loadConnections();
      toast("Подключение сохранено.", "success");
    } catch (error) {
      if (handle401(error)) return;
      setLoading(button, false);
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
    }
  }

  async function disconnect(provider, button) {
    if (!window.confirm("Отключить платформу и удалить ее сохраненное OAuth-подключение из hosted storage?")) return;
    setLoading(button, true);
    try {
      await api("/api/hosted/connections/disconnect", "POST", { provider });
      if (state.activePending?.provider === provider) state.activePending = null;
      state.notice = { tone: "success", text: "Платформа отключена." };
      await loadConnections();
    } catch (error) {
      if (handle401(error)) return;
      setLoading(button, false);
      state.notice = { tone: "error", text: humanizeError(error) };
      renderConnections(state.connections);
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
        <td>${esc(formatTime(user.created_at))}</td>
        <td>${esc(formatTime(user.last_login_at))}</td>
        <td>${esc(user.platform_connections ?? 0)}</td>
        <td>
          <div class="admin-table__actions">
            <button class="btn btn--secondary btn--small" data-admin-status="${escAttr(user.id)}" data-status="${user.status === "active" ? "disabled" : "active"}">${user.status === "active" ? "Отключить" : "Включить"}</button>
            <button class="btn btn--secondary btn--small" data-admin-role="${escAttr(user.id)}" data-role="${user.role === "admin" ? "user" : "admin"}">${user.role === "admin" ? "Сделать user" : "Сделать admin"}</button>
          </div>
        </td>
      </tr>
    `).join("");
    const database = diagnostics.database || {};
    el.adminContent.innerHTML = `
      <div class="diag-grid">
        <article class="card">
          <h3 class="card__title">Database</h3>
          ${kvGrid([
            ["Статус", statusValue(database.status)],
            ["Driver", esc(database.driver || "—")],
            ["Users", esc(database.users ?? "—")],
            ["Active sessions", esc(database.active_sessions ?? "—")],
          ])}
        </article>
        <article class="card">
          <h3 class="card__title">Security</h3>
          ${kvGrid([
            ["Preview-only", boolValue(diagnostics.security?.preview_only, true)],
            ["API token configured", boolValue(diagnostics.security?.beta_token_configured, true)],
            ["Secrets redacted", boolValue(diagnostics.security?.secrets_redacted, true)],
          ])}
        </article>
      </div>
      <article class="card">
        <h3 class="card__title">Пользователи</h3>
        <table class="admin-table">
          <thead><tr><th>Пользователь</th><th>Роль</th><th>Статус</th><th>Создан</th><th>Последний вход</th><th>Платформы</th><th>Действия</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">Пользователей пока нет.</td></tr>`}</tbody>
        </table>
      </article>
    `;
    el.adminContent.querySelectorAll("[data-admin-status]").forEach((button) => {
      button.addEventListener("click", () => updateAdminUser(button.dataset.adminStatus, { status: button.dataset.status }, "/api/admin/users/status", button));
    });
    el.adminContent.querySelectorAll("[data-admin-role]").forEach((button) => {
      button.addEventListener("click", () => updateAdminUser(button.dataset.adminRole, { role: button.dataset.role }, "/api/admin/users/role", button));
    });
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
    if (missingEnv || !platform.oauth_configured) return "credentials_missing";
    return "ready_to_connect";
  }

  function statusBadge(status, limited) {
    const map = {
      connected: ["Подключено", "ok"],
      ready_to_connect: ["Доступно для подключения", "info"],
      select_accounts: ["Выберите аккаунты", "warn"],
      reconnect_required: ["Нужно переподключить", "warn"],
      credentials_missing: ["Платформа настраивается", "muted"],
      error: ["Ошибка подключения", "err"],
    };
    const [label, tone] = map[status] || ["Статус неизвестен", "muted"];
    const limitedChip = limited ? `<span class="badge badge--muted">Ограниченная beta</span>` : "";
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${limitedChip}<span class="badge badge--${tone}">${esc(label)}</span></div>`;
  }

  function statusHint(status, canConnect) {
    if (status === "connected") return "Подключенные аккаунты доступны через hosted MCP tools.";
    if (status === "select_accounts") return "OAuth завершен. Выберите аккаунты, чтобы закончить подключение.";
    if (status === "reconnect_required") return "Время выбора аккаунтов истекло. Переподключите платформу.";
    if (status === "credentials_missing") {
      return "Подключение этой платформы временно настраивается. Если нужно ускорить доступ, обратитесь к менеджеру AdForge.";
    }
    if (status === "ready_to_connect") return "Платформа готова. Нажмите подключить и пройдите OAuth.";
    return canConnect ? "Нажмите подключить и пройдите OAuth." : "Платформа временно настраивается.";
  }

  function statusLabel(status) {
    return {
      mcp_ready: "MCP готов",
      ready: "готово",
      ok: "ok",
      connected: "подключено",
      not_connected: "не подключено",
      pending_account_selection: "выберите аккаунты",
      reconnect_required: "нужно переподключить",
      token_expired: "токен истек",
      env_missing: "платформа настраивается",
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
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { method, headers, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined });
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
      return "Код доступа еще не настроен на сервере. Обратитесь к менеджеру AdForge.";
    }
    if (lower.includes("api_auth_required") || lower.includes("beta token")) {
      return "Нужен корректный код доступа.";
    }
    if (lower.includes("not configured") && lower.includes("oauth")) {
      return "Платформа временно настраивается. Обратитесь к менеджеру AdForge, если подключение нужно ускорить.";
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

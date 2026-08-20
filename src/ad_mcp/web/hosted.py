from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from ad_mcp.core.config_loader import load_provider_from_connections
from ad_mcp.core.connection_store import HostedConnectionStore, safe_account_summary
from ad_mcp.settings import Settings
from ad_mcp.web.meta_oauth import MetaOAuthService
from ad_mcp.web.partner_oauth import GoogleOAuthService, GoogleSearchConsoleOAuthService, TikTokOAuthService, YandexOAuthService


@dataclass(frozen=True)
class PlatformDescriptor:
    provider: str
    label: str
    beta_priority: str
    oauth_target: bool


PLATFORMS = (
    PlatformDescriptor("meta_ads", "Meta Ads", "beta", True),
    PlatformDescriptor("google_ads", "Google Ads", "beta", True),
    PlatformDescriptor("google_search_console", "Google Search Console", "beta", True),
    PlatformDescriptor("tiktok_ads", "TikTok Ads", "next", True),
    PlatformDescriptor("yandex_direct", "Yandex Direct", "next", True),
)

OAUTH_REDIRECT_SETTINGS = {
    "meta_ads": "meta_oauth_redirect_path",
    "google_ads": "google_oauth_redirect_path",
    "google_search_console": "google_search_console_redirect_path",
    "tiktok_ads": "tiktok_oauth_redirect_path",
    "yandex_direct": "yandex_oauth_redirect_path",
}

OAUTH_PROVIDER_SLUGS = {
    "meta_ads": "meta",
    "google_ads": "google",
    "google_search_console": "search-console",
    "tiktok_ads": "tiktok",
    "yandex_direct": "yandex",
}

OAUTH_REQUIRED_ENV = {
    "meta_ads": ("AD_MCP_META_OAUTH_APP_ID", "AD_MCP_META_OAUTH_APP_SECRET"),
    "google_ads": ("AD_MCP_GOOGLE_OAUTH_CLIENT_ID", "AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET", "AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN"),
    "google_search_console": ("AD_MCP_GOOGLE_OAUTH_CLIENT_ID", "AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET"),
    "tiktok_ads": ("AD_MCP_TIKTOK_OAUTH_APP_ID", "AD_MCP_TIKTOK_OAUTH_APP_SECRET"),
    "yandex_direct": ("AD_MCP_YANDEX_OAUTH_CLIENT_ID", "AD_MCP_YANDEX_OAUTH_CLIENT_SECRET"),
}

OAUTH_OPTIONAL_ENV = {
    "meta_ads": ("AD_MCP_META_OAUTH_API_VERSION", "AD_MCP_META_OAUTH_SCOPES"),
    "google_ads": ("AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID", "AD_MCP_GOOGLE_ADS_API_VERSION", "AD_MCP_GOOGLE_OAUTH_SCOPES"),
    "google_search_console": ("AD_MCP_GOOGLE_SEARCH_CONSOLE_SCOPES",),
    "tiktok_ads": (
        "AD_MCP_TIKTOK_OAUTH_AUTH_URL",
        "AD_MCP_TIKTOK_OAUTH_TOKEN_URL",
        "AD_MCP_TIKTOK_OAUTH_ADVERTISER_GET_URL",
        "AD_MCP_TIKTOK_OAUTH_ADVERTISER_ID",
        "AD_MCP_TIKTOK_OAUTH_PUBLIC_ENABLED",
    ),
    "yandex_direct": (
        "AD_MCP_YANDEX_OAUTH_SCOPE",
        "AD_MCP_YANDEX_DIRECT_CLIENTS_URL",
        "AD_MCP_YANDEX_DIRECT_LOGIN",
        "AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN",
        "AD_MCP_YANDEX_OAUTH_PUBLIC_ENABLED",
    ),
}

ENV_TO_SETTING = {
    "AD_MCP_META_OAUTH_APP_ID": "meta_oauth_app_id",
    "AD_MCP_META_OAUTH_APP_SECRET": "meta_oauth_app_secret",
    "AD_MCP_META_OAUTH_API_VERSION": "meta_oauth_api_version",
    "AD_MCP_META_OAUTH_SCOPES": "meta_oauth_scopes",
    "AD_MCP_GOOGLE_OAUTH_CLIENT_ID": "google_oauth_client_id",
    "AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET": "google_oauth_client_secret",
    "AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN": "google_ads_developer_token",
    "AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID": "google_ads_login_customer_id",
    "AD_MCP_GOOGLE_ADS_API_VERSION": "google_ads_api_version",
    "AD_MCP_GOOGLE_OAUTH_SCOPES": "google_oauth_scopes",
    "AD_MCP_GOOGLE_SEARCH_CONSOLE_SCOPES": "google_search_console_scopes",
    "AD_MCP_TIKTOK_OAUTH_APP_ID": "tiktok_oauth_app_id",
    "AD_MCP_TIKTOK_OAUTH_APP_SECRET": "tiktok_oauth_app_secret",
    "AD_MCP_TIKTOK_OAUTH_AUTH_URL": "tiktok_oauth_auth_url",
    "AD_MCP_TIKTOK_OAUTH_TOKEN_URL": "tiktok_oauth_token_url",
    "AD_MCP_TIKTOK_OAUTH_ADVERTISER_GET_URL": "tiktok_oauth_advertiser_get_url",
    "AD_MCP_TIKTOK_OAUTH_ADVERTISER_ID": "tiktok_oauth_advertiser_id",
    "AD_MCP_TIKTOK_OAUTH_PUBLIC_ENABLED": "tiktok_oauth_public_enabled",
    "AD_MCP_YANDEX_OAUTH_CLIENT_ID": "yandex_oauth_client_id",
    "AD_MCP_YANDEX_OAUTH_CLIENT_SECRET": "yandex_oauth_client_secret",
    "AD_MCP_YANDEX_OAUTH_SCOPE": "yandex_oauth_scope",
    "AD_MCP_YANDEX_DIRECT_CLIENTS_URL": "yandex_direct_clients_url",
    "AD_MCP_YANDEX_DIRECT_LOGIN": "yandex_direct_login",
    "AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN": "yandex_direct_client_login",
    "AD_MCP_YANDEX_OAUTH_PUBLIC_ENABLED": "yandex_oauth_public_enabled",
}

OAUTH_PUBLIC_ENABLE_SETTINGS = {
    "tiktok_ads": "tiktok_oauth_public_enabled",
    "yandex_direct": "yandex_oauth_public_enabled",
}

OAUTH_PROVIDER_SETUP = {
    "meta_ads": [
        "Meta App Dashboard: добавьте точный Redirect URL в Facebook Login / Valid OAuth Redirect URIs.",
        "Redirect URL должен совпадать символ в символ: {redirect_url}",
        "Проверьте app id/app secret, Ads API permissions и доступ тестового пользователя к Business/Ad Accounts.",
    ],
    "google_ads": [
        "Google Cloud Console: OAuth Client type должен быть Web application.",
        "Authorized redirect URI должен совпадать символ в символ: {redirect_url}",
        "Проверьте OAuth consent screen, test users, Google Ads API и AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN.",
    ],
    "google_search_console": [
        "Google Cloud Console: OAuth Client type должен быть Web application.",
        "Authorized redirect URI должен совпадать символ в символ: {redirect_url}",
        "Включите Google Search Console API и добавьте scope https://www.googleapis.com/auth/webmasters.readonly в OAuth consent screen.",
    ],
    "tiktok_ads": [
        "TikTok for Business Developer: добавьте точный Redirect URL в приложение.",
        "Redirect URL должен совпадать символ в символ: {redirect_url}",
        "После проверки app_id/app_secret и redirect URL включите AD_MCP_TIKTOK_OAUTH_PUBLIC_ENABLED=true.",
    ],
    "yandex_direct": [
        "Yandex OAuth: client_id должен быть именно ID OAuth-приложения, а не логин/номер рекламного аккаунта.",
        "В OAuth-приложении добавьте Redirect URI: {redirect_url}",
        "После проверки client_id/client_secret и direct:api scope включите AD_MCP_YANDEX_OAUTH_PUBLIC_ENABLED=true.",
    ],
}

def _route_path(path: str) -> str:
    clean = (path or "/mcp").strip()
    if not clean.startswith("/"):
        clean = f"/{clean}"
    return clean


def _join_url(base_url: str, path: str) -> str:
    base = base_url.rstrip("/")
    route = _route_path(path)
    if not base:
        return route
    return f"{base}{route}"


class HostedConnectionService:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or Settings()
        self._store = HostedConnectionStore(
            self._settings.connection_store_file,
            encryption_key=self._settings.credentials_encryption_key,
            allow_legacy_plaintext=self._settings.credentials_allow_legacy_plaintext,
            encryption_required=self._settings.credentials_encryption_required,
        )
        self._meta_oauth = MetaOAuthService(self._settings)
        self._google_oauth = GoogleOAuthService(self._settings)
        self._google_search_console_oauth = GoogleSearchConsoleOAuthService(self._settings)
        self._tiktok_oauth = TikTokOAuthService(self._settings)
        self._yandex_oauth = YandexOAuthService(self._settings)

    def _public_base_url(self) -> str:
        return self._settings.public_base_or_local_web_url

    def _workspace_id(self, user: Any | None = None) -> str | None:
        value = getattr(user, "workspace_id", None)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def _user_id(self, user: Any | None = None) -> str | None:
        value = getattr(user, "id", None)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def mcp_connection_info(self) -> dict[str, Any]:
        endpoint_path = self._settings.mcp_route_path
        public_url = self._settings.public_mcp_url
        clients = {
            "codex": {
                "label": "Codex",
                "status": "ready",
                "transport": "streamable_http",
                "auth": "authorization_header_or_bearer_env",
                "summary": "Готово: используйте адрес подключения и персональный ключ доступа.",
                "instructions": [
                    "Добавьте HolyMedia MCP как HTTP-подключение.",
                    "URL: используйте адрес подключения из dashboard.",
                    "Для доступа используйте персональный ключ из раздела MCP.",
                    "После добавления откройте новый чат и спросите про подключенные рекламные аккаунты.",
                ],
            },
            "claude": {
                "label": "Claude",
                "status": "oauth_ready",
                "transport": "remote_mcp_http",
                "auth": "oauth_2_1_pkce_or_authorization_token",
                "summary": "Claude подключается через custom connector и вход в HolyMedia MCP.",
                "instructions": [
                    "В Claude.ai Add custom connector можно указать Name и Remote MCP server URL.",
                    "OAuth Client ID/Secret можно оставить пустыми, если Claude подключается автоматически.",
                    "Пользователь войдет в HolyMedia MCP в браузере и разрешит доступ к своему рабочему пространству.",
                    "Персональный ключ доступа не нужно вставлять в OAuth Client Secret.",
                ],
            },
            "chatgpt": {
                "label": "ChatGPT",
                "status": "oauth_cimd_ready",
                "transport": "streamable_http",
                "auth": "oauth_2_1_pkce_with_cimd",
                "self_serve_ready": True,
                "summary": "ChatGPT подключается через custom connector и безопасный вход в HolyMedia MCP.",
                "instructions": [
                    "В ChatGPT custom connector укажите URL из dashboard, обычно https://mcp.holymedia.kz/mcp.",
                    "Authentication: OAuth.",
                    "В расширенных настройках используйте автоматическую регистрацию клиента, если ChatGPT показывает этот вариант.",
                    "Token endpoint authentication method: none.",
                    "При первом использовании ChatGPT откроет вход в HolyMedia MCP.",
                ],
            },
        }
        return {
            "name": "HolyMedia MCP",
            "transport": "streamable_http",
            "endpoint_path": endpoint_path,
            "url": public_url,
            "auth": {
                "type": "bearer",
                "header": "Authorization",
                "token_env": "ADFORGE_MCP_CLIENT_TOKEN",
            },
            "client_notes": {
                "codex": clients["codex"]["summary"],
                "claude": clients["claude"]["summary"],
                "chatgpt": clients["chatgpt"]["summary"],
                "gemini": "Use the client-specific custom connector flow if it supports remote MCP plus Authorization headers.",
            },
            "clients": clients,
            "chatgpt_oauth_required": False,
            "chatgpt_cimd_supported": True,
            "status": "transport_available",
            "message": "HolyMedia MCP доступен по этому адресу подключения.",
        }

    def connections(self, user: Any | None = None) -> dict[str, Any]:
        workspace_id = self._workspace_id(user)
        platforms = [self._platform_status(platform, workspace_id=workspace_id) for platform in PLATFORMS]
        return {
            "mode": "hosted_oauth_beta",
            "mcp": self.mcp_connection_info(),
            "connection_store": self._store.status() | {"path": self._settings.connection_store_path},
            "storage_scope": "workspace" if workspace_id else "global_compatibility_store",
            "platforms": platforms,
        }

    def oauth_diagnostics(self, provider: str | None = None) -> dict[str, Any]:
        requested = [platform for platform in PLATFORMS if provider in (None, platform.provider)]
        if provider is not None and not requested:
            raise ValueError(f"Unsupported provider: {provider}")
        return {
            "mode": "code_and_configuration_check",
            "live_credentials_checked": False,
            "message": "Diagnostics validate local OAuth configuration and storage state. They do not prove live provider credentials work.",
            "providers": [self._oauth_diagnostics_for(platform) for platform in requested],
        }

    def oauth_readiness(self, provider: str | None = None) -> dict[str, Any]:
        requested = [platform for platform in PLATFORMS if provider in (None, platform.provider)]
        if provider is not None and not requested:
            raise ValueError(f"Unsupported provider: {provider}")
        platforms = [self._oauth_readiness_for(platform) for platform in requested]
        ready_count = sum(1 for item in platforms if item["overall_status"] == "ready_to_connect")
        return {
            "mode": "oauth_end_to_end_readiness",
            "public_base_url": self._public_base_url(),
            "storage_scope": "workspace_for_user_sessions_and_personal_mcp",
            "workspace_scoping": "enabled_for_dashboard_oauth",
            "summary": {
                "platform_count": len(platforms),
                "ready_to_connect": ready_count,
                "blocked": len(platforms) - ready_count,
            },
            "platforms": platforms,
        }

    def dashboard_oauth_return_url(self, provider: str, payload: dict[str, Any] | None = None, error: str | None = None) -> str:
        metadata = payload.get("metadata", {}) if isinstance(payload, dict) else {}
        manual_request_id = str(metadata.get("manual_request_id") or "") if isinstance(metadata, dict) else ""
        if provider == "meta_ads" and manual_request_id:
            query = {
                "manual_meta_request": manual_request_id,
                "status": str(payload.get("status") or "pending_account_selection"),
            }
            if payload.get("pending_id"):
                query["pending_id"] = str(payload["pending_id"])
            return f"/admin?{urlencode(query)}"
        query: dict[str, str] = {"section": "connections", "provider": provider}
        if error:
            query["status"] = "error"
            query["oauth_error"] = error
        elif payload:
            query["status"] = str(payload.get("status") or "pending_account_selection")
            if payload.get("pending_id"):
                query["pending_id"] = str(payload["pending_id"])
        return f"/?{urlencode(query)}"

    def import_local_provider(self, provider: str, user: Any | None = None) -> dict[str, Any]:
        if provider not in {platform.provider for platform in PLATFORMS}:
            return {"provider": provider, "status": "unsupported_provider"}
        if not self._settings.connections_config_path.exists():
            return {"provider": provider, "status": "no_local_config"}
        provider_config = load_provider_from_connections(self._settings.connections_config_path, provider)
        accounts = provider_config.get("accounts", [])
        if not accounts:
            return {"provider": provider, "status": "no_local_accounts"}
        saved = self._store.save_provider_config(
            provider,
            provider_config,
            source="local_import",
            workspace_id=self._workspace_id(user),
            user_id=self._user_id(user),
        )
        return {
            "provider": provider,
            "status": "imported",
            "source": "local_connections_config",
            "accounts": saved["accounts"],
        }

    def oauth_start_preview(self, provider: str) -> dict[str, Any]:
        known = {platform.provider: platform for platform in PLATFORMS}
        if provider not in known:
            return {"provider": provider, "status": "unsupported_provider"}
        platform = known[provider]
        if not platform.oauth_target:
            return {
                "provider": platform.provider,
                "label": platform.label,
                "status": "planned_later",
                "message": "This platform is outside the first beta OAuth scope.",
            }
        service = self._oauth_service(provider)
        credentials_configured = service.configured() if service is not None else False
        public_enabled = self._oauth_public_enabled(provider)
        ready = credentials_configured and public_enabled
        return {
            "provider": platform.provider,
            "label": platform.label,
            "status": "oauth_ready" if ready else "oauth_not_configured",
            "credentials_configured": credentials_configured,
            "public_connection_enabled": public_enabled,
            "redirect_url": _join_url(self._public_base_url(), self._oauth_redirect_path(platform.provider)),
            "message": "OAuth can start when app credentials and provider dashboard settings are verified.",
        }

    def meta_oauth_redirect_url(self, user: Any | None = None) -> str:
        if self._settings.meta_manual_onboarding_enabled:
            raise ValueError("Подключение Meta через OAuth временно выполняется специалистом HolyMedia.")
        return self._meta_oauth.authorization_url(workspace_id=self._workspace_id(user), user_id=self._user_id(user))

    def meta_oauth_callback(self, query: dict[str, str]) -> dict[str, Any]:
        return self._meta_oauth.handle_callback(query)

    def meta_oauth_pending(self, pending_id: str, user: Any | None = None) -> dict[str, Any]:
        return self._meta_oauth.pending_selection(pending_id, workspace_id=self._workspace_id(user))

    def meta_oauth_select(self, payload: dict[str, Any], user: Any | None = None) -> dict[str, Any]:
        pending_id = str(payload["pending_id"])
        account_ids = payload.get("account_ids") or []
        return self._meta_oauth.select_accounts(
            pending_id,
            [str(item) for item in account_ids],
            workspace_id=self._workspace_id(user),
            user_id=self._user_id(user),
        )

    @staticmethod
    def _manual_meta_account_id(value: Any) -> str:
        clean = str(value or "").strip()
        return clean if clean.startswith("act_") else f"act_{clean}"

    def manual_meta_oauth_authorization_info(self, request: dict[str, Any]) -> dict[str, Any]:
        request_id = str(request.get("id") or "").strip()
        workspace_id = str(request.get("workspace_id") or "").strip()
        user_id = str(request.get("user_id") or "").strip()
        if not request_id or not workspace_id or not user_id:
            raise ValueError("Заявка не содержит безопасную привязку к пользователю и workspace.")
        if str(request.get("status") or "") in {"completed", "cancelled"}:
            raise ValueError("Эта заявка уже закрыта.")
        return {
            "request_id": request_id,
            "status": "oauth_ready",
            "authorization_url": self._meta_oauth.authorization_url(
                workspace_id=workspace_id,
                user_id=user_id,
                manual_request_id=request_id,
                include_ads_management=False,
            ),
        }

    def manual_meta_oauth_pending(self, request: dict[str, Any], pending_id: str) -> dict[str, Any]:
        pending = self._meta_oauth.pending_selection(
            str(pending_id or "").strip(),
            workspace_id=str(request.get("workspace_id") or "").strip(),
        )
        metadata = pending.get("metadata", {}) if isinstance(pending.get("metadata"), dict) else {}
        if str(metadata.get("manual_request_id") or "") != str(request.get("id") or ""):
            raise ValueError("OAuth-сессия не относится к выбранной заявке.")
        requested_account_id = self._manual_meta_account_id(request.get("meta_ad_account_id"))
        accounts = [
            account
            for account in pending.get("accounts", [])
            if self._manual_meta_account_id(account.get("account_id")) == requested_account_id
        ]
        if not accounts:
            raise ValueError("У специалиста нет доступа к рекламному кабинету из заявки.")
        return pending | {"accounts": accounts, "requested_account_id": requested_account_id}

    def manual_meta_oauth_select(self, request: dict[str, Any], pending_id: str) -> dict[str, Any]:
        pending = self.manual_meta_oauth_pending(request, pending_id)
        account_id = str(pending["requested_account_id"])
        return self._meta_oauth.select_accounts(
            str(pending_id or "").strip(),
            [account_id],
            workspace_id=str(request.get("workspace_id") or "").strip(),
            user_id=str(request.get("user_id") or "").strip(),
        )

    def oauth_redirect_url(self, provider: str, user: Any | None = None) -> str:
        if provider == "meta_ads" and self._settings.meta_manual_onboarding_enabled:
            raise ValueError("Подключение Meta через OAuth временно выполняется специалистом HolyMedia.")
        service = self._require_oauth_service(provider)
        self._ensure_oauth_public(provider)
        return service.authorization_url(workspace_id=self._workspace_id(user), user_id=self._user_id(user))

    def oauth_authorization_info(self, provider: str, user: Any | None = None) -> dict[str, Any]:
        if provider == "meta_ads" and self._settings.meta_manual_onboarding_enabled:
            raise ValueError("Подключение Meta через OAuth временно выполняется специалистом HolyMedia.")
        service = self._require_oauth_service(provider)
        self._ensure_oauth_public(provider)
        return {
            "provider": provider,
            "status": "oauth_ready",
            "authorization_url": service.authorization_url(workspace_id=self._workspace_id(user), user_id=self._user_id(user)),
        }

    def oauth_callback(self, provider: str, query: dict[str, str]) -> dict[str, Any]:
        service = self._require_oauth_service(provider)
        return service.handle_callback(query)

    def oauth_pending(self, provider: str, pending_id: str, user: Any | None = None) -> dict[str, Any]:
        service = self._require_oauth_service(provider)
        return service.pending_selection(pending_id, workspace_id=self._workspace_id(user))

    def oauth_select(self, provider: str, payload: dict[str, Any], user: Any | None = None) -> dict[str, Any]:
        service = self._require_oauth_service(provider)
        pending_id = str(payload["pending_id"])
        account_ids = payload.get("account_ids") or []
        return service.select_accounts(
            pending_id,
            [str(item) for item in account_ids],
            workspace_id=self._workspace_id(user),
            user_id=self._user_id(user),
        )

    def disconnect_provider(self, provider: str, user: Any | None = None) -> dict[str, Any]:
        if provider not in {platform.provider for platform in PLATFORMS}:
            raise ValueError(f"Unsupported provider: {provider}")
        disconnected = self._store.disconnect_provider(provider, workspace_id=self._workspace_id(user))
        return {"provider": provider, "status": "disconnected", "accounts": disconnected["accounts"]}

    def mcp_transport_placeholder(self) -> dict[str, Any]:
        info = self.mcp_connection_info()
        return {
            "error": "This legacy web process does not serve MCP traffic. Run ad-mcp-http or route /mcp to the hosted MCP process.",
            "code": "mcp_transport_on_separate_process",
            "mcp": info,
        }

    def _platform_status(self, platform: PlatformDescriptor, workspace_id: str | None = None) -> dict[str, Any]:
        hosted_config = self._store.provider_config(platform.provider, workspace_id=workspace_id)
        hosted_accounts = hosted_config.get("accounts", [])
        store_data = self._store.read()
        stored_connection = (
            store_data.get("connections", {})
            if isinstance(store_data.get("connections", {}), dict)
            else {}
        ).get(platform.provider, {})
        provider_config = load_provider_from_connections(self._settings.connections_config_path, platform.provider)
        accounts = provider_config.get("accounts", [])
        safe_accounts = [safe_account_summary(account) for account in hosted_accounts if isinstance(account, dict)]
        local_safe_accounts = [safe_account_summary(account) for account in accounts if isinstance(account, dict)]
        pending_selections = self._store.pending_selections(platform.provider, workspace_id=workspace_id)
        active_pending = [item for item in pending_selections if item.get("status") == "pending_account_selection"]
        expired_pending = [item for item in pending_selections if item.get("status") == "expired"]
        has_oauth_connection = bool(hosted_accounts)
        oauth_preview = self.oauth_start_preview(platform.provider)
        oauth_credentials_configured = bool(oauth_preview.get("credentials_configured"))
        oauth_public_enabled = bool(oauth_preview.get("public_connection_enabled"))
        if has_oauth_connection:
            status = "connected"
            source = "hosted_connection_store"
        elif active_pending:
            status = "pending_account_selection"
            source = "hosted_connection_store"
        elif expired_pending:
            status = "expired/reconnect_required"
            source = "hosted_connection_store"
        elif local_safe_accounts and self._settings.connections_fallback_to_local:
            status = "development_configured"
            source = "local_connections_config"
            safe_accounts = local_safe_accounts
        elif platform.oauth_target and oauth_credentials_configured and not oauth_public_enabled:
            status = "provider_setup_required"
            source = "none"
        elif platform.oauth_target:
            status = "not_connected"
            source = "none"
        else:
            status = "planned_later"
            source = "none"
        missing_env = [
            name
            for name in OAUTH_REQUIRED_ENV.get(platform.provider, ())
            if not str(getattr(self._settings, ENV_TO_SETTING[name], "") or "").strip()
        ]
        last_error = None
        if expired_pending:
            last_error = {
                "status": "expired",
                "message": "OAuth pending account selection expired. Reconnect this platform.",
            }
        elif missing_env:
            last_error = {
                "status": "env_missing",
                "message": "OAuth app credentials are missing on the server.",
            }
        elif platform.oauth_target and oauth_credentials_configured and not oauth_public_enabled:
            last_error = {
                "status": "provider_dashboard_setup_required",
                "message": "OAuth credentials exist, but provider dashboard settings must be verified before client connection is exposed.",
            }
        diagnostic_status = status
        if status == "connected" and not missing_env:
            diagnostic_status = "mcp_ready"
        elif missing_env:
            diagnostic_status = "env_missing"
        elif status == "provider_setup_required":
            diagnostic_status = "provider_setup_required"
        return {
            "provider": platform.provider,
            "label": platform.label,
            "beta_priority": platform.beta_priority,
            "oauth_target": platform.oauth_target,
            "oauth_configured": oauth_preview.get("status") == "oauth_ready",
            "oauth_credentials_configured": oauth_credentials_configured,
            "oauth_public_enabled": oauth_public_enabled,
            "manual_onboarding_enabled": platform.provider == "meta_ads" and self._settings.meta_manual_onboarding_enabled,
            "oauth_redirect_url": oauth_preview.get("redirect_url"),
            "status": status,
            "source": source,
            "accounts": safe_accounts,
            "pending_selections": pending_selections,
            "diagnostic_summary": {
                "status": diagnostic_status,
                "account_count": len(safe_accounts),
                "last_successful_update": stored_connection.get("updated_at") or stored_connection.get("created_at") if isinstance(stored_connection, dict) else None,
                "last_error": last_error,
                "missing_required_env": missing_env,
                "run_diagnostics_endpoint": f"/api/diagnostics/platforms/{platform.provider}?live=1",
            },
        }

    def _oauth_redirect_path(self, provider: str) -> str:
        setting_name = OAUTH_REDIRECT_SETTINGS.get(provider)
        if not setting_name:
            return f"/oauth/{provider}/callback"
        return str(getattr(self._settings, setting_name))

    def _oauth_diagnostics_for(self, platform: PlatformDescriptor) -> dict[str, Any]:
        service = self._oauth_service(platform.provider)
        required = OAUTH_REQUIRED_ENV.get(platform.provider, ())
        optional = OAUTH_OPTIONAL_ENV.get(platform.provider, ())
        missing_required = [name for name in required if not str(getattr(self._settings, ENV_TO_SETTING[name], "") or "").strip()]
        configured_optional = [name for name in optional if str(getattr(self._settings, ENV_TO_SETTING[name], "") or "").strip()]
        platform_status = self._platform_status(platform)
        slug = OAUTH_PROVIDER_SLUGS[platform.provider]
        public_enabled = self._oauth_public_enabled(platform.provider)
        return {
            "provider": platform.provider,
            "label": platform.label,
            "status": "configured" if service and service.configured() else "missing_env",
            "client_visible_status": self._oauth_client_visible_status(platform.provider, missing_required),
            "public_connection_enabled": public_enabled,
            "missing_required_env": missing_required,
            "configured_optional_env": configured_optional,
            "redirect_url": _join_url(self._public_base_url(), self._oauth_redirect_path(platform.provider)),
            "start_endpoint": f"/api/hosted/oauth/{slug}/start",
            "authorize_url_endpoint": f"/api/hosted/oauth/{slug}/authorize-url",
            "callback_endpoint": self._oauth_redirect_path(platform.provider),
            "pending_endpoint": f"/api/hosted/oauth/{slug}/pending?pending_id=<pending-id>",
            "select_endpoint": f"/api/hosted/oauth/{slug}/select",
            "connected_account_count": len(platform_status.get("accounts", [])),
            "pending_selection_count": len(platform_status.get("pending_selections", [])),
            "notes": self._oauth_provider_notes(platform.provider),
            "setup_instructions": self._oauth_provider_setup(platform.provider),
        }

    def _oauth_readiness_for(self, platform: PlatformDescriptor) -> dict[str, Any]:
        diagnostic = self._oauth_diagnostics_for(platform)
        platform_status = self._platform_status(platform)
        missing_required = diagnostic["missing_required_env"]
        credentials_present = diagnostic["status"] == "configured"
        public_enabled = bool(diagnostic["public_connection_enabled"])
        connected_account_count = int(diagnostic["connected_account_count"])
        pending_selection_count = int(diagnostic["pending_selection_count"])
        authorize_status = self._authorize_url_readiness(platform.provider, credentials_present, public_enabled)
        connect_enabled = credentials_present and public_enabled and authorize_status["status"] == "ready"
        if connect_enabled:
            overall_status = "ready_to_connect"
        elif missing_required:
            overall_status = "blocked_missing_credentials"
        elif authorize_status["status"] == "blocked_manual_onboarding":
            overall_status = "blocked_manual_onboarding"
        elif not public_enabled:
            overall_status = "blocked_provider_dashboard_check"
        else:
            overall_status = "blocked_authorize_url"
        read_tools_status = self._read_tools_status(platform.provider, connected_account_count)
        blockers = self._oauth_blockers(platform.provider, missing_required, public_enabled, authorize_status)
        return {
            "provider": platform.provider,
            "label": platform.label,
            "overall_status": overall_status,
            "credentials_present": credentials_present,
            "missing_required_env": missing_required,
            "public_connection_enabled": public_enabled,
            "manual_onboarding_enabled": platform.provider == "meta_ads" and self._settings.meta_manual_onboarding_enabled,
            "expected_redirect_url": diagnostic["redirect_url"],
            "authorize_url": authorize_status,
            "connect_button_enabled": connect_enabled,
            "callback_endpoint": diagnostic["callback_endpoint"],
            "pending_account_selection_supported": True,
            "pending_selection_count": pending_selection_count,
            "connected_account_count": connected_account_count,
            "selected_accounts_saved": connected_account_count > 0,
            "read_tools_status": read_tools_status,
            "last_oauth_attempt_status": "not_recorded",
            "last_callback_status": "not_recorded",
            "last_provider_error": "not_recorded",
            "storage_limitation": "Dashboard OAuth uses workspace-scoped storage for signed-in users; old beta-token fallback may still use the global compatibility store.",
            "client_status": "Доступно для подключения" if connect_enabled else "Платформа временно недоступна",
            "admin_status": platform_status["diagnostic_summary"]["status"],
            "required_operator_action": self._operator_actions(platform.provider, missing_required, public_enabled, blockers),
            "blockers": blockers,
            "setup_instructions": diagnostic["setup_instructions"],
        }

    def _authorize_url_readiness(self, provider: str, credentials_present: bool, public_enabled: bool) -> dict[str, Any]:
        if provider == "meta_ads" and self._settings.meta_manual_onboarding_enabled:
            return {
                "status": "blocked_manual_onboarding",
                "message": "Meta подключается через заявку специалисту до завершения App Review.",
            }
        if not credentials_present:
            return {"status": "blocked_missing_credentials", "message": "Required OAuth env credentials are missing."}
        if not public_enabled:
            return {
                "status": "blocked_public_disabled",
                "message": "Credentials are present, but public OAuth is disabled until provider dashboard settings are verified.",
            }
        service = self._oauth_service(provider)
        if service is None:
            return {"status": "unsupported_provider", "message": "OAuth flow is not implemented."}
        return {
            "status": "ready",
            "message": "Authorize URL can be generated for client connect.",
            "redirect_uri": _join_url(self._public_base_url(), self._oauth_redirect_path(provider)),
            "authorize_url_endpoint": f"/api/hosted/oauth/{OAUTH_PROVIDER_SLUGS[provider]}/authorize-url",
        }

    def _read_tools_status(self, provider: str, connected_account_count: int) -> str:
        if connected_account_count <= 0:
            return "waiting_for_connected_accounts"
        if provider in {"meta_ads", "google_ads"}:
            return "real_read_tools_available_when_provider_api_permissions_allow"
        return "limited_not_available_for_campaigns_or_metrics_until_provider_reads_are_completed"

    def _oauth_blockers(
        self,
        provider: str,
        missing_required: list[str],
        public_enabled: bool,
        authorize_status: dict[str, Any],
    ) -> list[str]:
        blockers: list[str] = []
        if missing_required:
            blockers.append("missing_required_env")
        if provider in OAUTH_PUBLIC_ENABLE_SETTINGS and not public_enabled:
            blockers.append("public_enabled_false")
        if authorize_status["status"] != "ready":
            blockers.append(authorize_status["status"])
        return blockers

    def _operator_actions(
        self,
        provider: str,
        missing_required: list[str],
        public_enabled: bool,
        blockers: list[str],
    ) -> list[str]:
        actions: list[str] = []
        if missing_required:
            actions.append(f"Добавьте env на VPS: {', '.join(missing_required)}.")
        if "public_enabled_false" in blockers:
            enable_env = {
                "tiktok_ads": "AD_MCP_TIKTOK_OAUTH_PUBLIC_ENABLED=true",
                "yandex_direct": "AD_MCP_YANDEX_OAUTH_PUBLIC_ENABLED=true",
            }.get(provider)
            if enable_env:
                actions.append(f"После проверки provider dashboard включите {enable_env}.")
        if not actions:
            actions.append("Запустите ручной OAuth connect и проверьте callback/account selection.")
        return actions

    def _oauth_provider_notes(self, provider: str) -> list[str]:
        notes = {
            "meta_ads": [
                "Callback exchanges code for a user token, attempts long-lived token exchange, then reads /me/adaccounts.",
                "Meta ad accounts are saved only after dashboard account selection.",
            ],
            "google_ads": [
                "Google OAuth must return a refresh_token; reconnect with consent prompt if it is absent.",
                "customers:listAccessibleCustomers is used first; manager customer_client discovery is attempted best-effort.",
            ],
            "google_search_console": [
                "Google OAuth must return a refresh_token; reconnect with consent prompt if it is absent.",
                "Search Console sites.list is used for property discovery; selected properties are saved separately from ad accounts.",
            ],
            "tiktok_ads": [
                "TikTok Business API OAuth endpoints are configurable because app/API versions can differ.",
                "Callback accepts auth_code and code; advertiser discovery reads token payload or advertiser/get.",
            ],
            "yandex_direct": [
                "Yandex OAuth uses direct:api scope.",
                "Clients.get is attempted for accessible logins; configured direct client login is used only as fallback.",
            ],
        }
        return notes.get(provider, [])

    def _oauth_public_enabled(self, provider: str) -> bool:
        setting_name = OAUTH_PUBLIC_ENABLE_SETTINGS.get(provider)
        if not setting_name:
            return True
        return bool(getattr(self._settings, setting_name))

    def _ensure_oauth_public(self, provider: str) -> None:
        if self._oauth_public_enabled(provider):
            return
        raise ValueError("Платформа настраивается. Мы откроем OAuth-подключение после проверки приложения провайдера.")

    def _oauth_client_visible_status(self, provider: str, missing_required: list[str]) -> str:
        if missing_required:
            return "platform_configuring"
        if not self._oauth_public_enabled(provider):
            return "platform_configuring"
        return "ready_to_connect"

    def _oauth_provider_setup(self, provider: str) -> list[str]:
        redirect_url = _join_url(self._public_base_url(), self._oauth_redirect_path(provider))
        return [item.format(redirect_url=redirect_url) for item in OAUTH_PROVIDER_SETUP.get(provider, [])]

    def _oauth_service(self, provider: str):
        services = {
            "meta_ads": self._meta_oauth,
            "google_ads": self._google_oauth,
            "google_search_console": self._google_search_console_oauth,
            "tiktok_ads": self._tiktok_oauth,
            "yandex_direct": self._yandex_oauth,
        }
        return services.get(provider)

    def _require_oauth_service(self, provider: str):
        service = self._oauth_service(provider)
        if service is None:
            raise ValueError(f"OAuth flow is not implemented for provider: {provider}")
        return service

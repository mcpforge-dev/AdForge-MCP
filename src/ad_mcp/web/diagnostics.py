from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.connection_store import (
    PROVIDER_NAMES,
    HostedConnectionStore,
    load_runtime_provider_configs,
    safe_account_summary,
)
from ad_mcp.core.errors import normalize_error
from ad_mcp.core.models import DateRange, ReportRequest
from ad_mcp.providers.google_ads.client import GoogleAdsProvider
from ad_mcp.providers.meta_ads.client import MetaAdsProvider
from ad_mcp.providers.tiktok_ads.client import TikTokAdsProvider
from ad_mcp.providers.yandex_direct.client import YandexDirectProvider
from ad_mcp.settings import Settings, is_network_exposed_host, is_strict_auth_env
from ad_mcp.web.hosted import (
    OAUTH_OPTIONAL_ENV,
    OAUTH_PROVIDER_SLUGS,
    OAUTH_REQUIRED_ENV,
    PLATFORMS,
    ENV_TO_SETTING,
    HostedConnectionService,
)


CORE_MCP_TOOLS = (
    "list_connected_platforms",
    "list_ad_accounts",
    "get_account_status",
    "run_connection_diagnostics",
    "run_diagnostics",
    "list_campaigns",
    "get_campaign",
    "get_campaign_statuses",
    "get_basic_metrics",
    "preview_pause_campaign",
    "preview_resume_campaign",
    "preview_change_campaign_budget",
    "preview_change_campaign_name",
    "commit_preview",
)


SECRET_PATTERN = re.compile(
    r"(?i)(access_token|refresh_token|client_secret|app_secret|developer_token|authorization|bearer)\s*[:=]\s*([^&\s,}]+)"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _redact(text: Any) -> str:
    return SECRET_PATTERN.sub(r"\1=[redacted]", str(text or ""))


def _env_status(settings: Settings, names: tuple[str, ...]) -> list[dict[str, Any]]:
    statuses: list[dict[str, Any]] = []
    for name in names:
        setting = ENV_TO_SETTING.get(name)
        value = getattr(settings, setting, "") if setting else ""
        statuses.append({"name": name, "status": "present" if str(value or "").strip() else "missing"})
    return statuses


def _missing_env(settings: Settings, provider: str) -> list[str]:
    return [item["name"] for item in _env_status(settings, OAUTH_REQUIRED_ENV.get(provider, ())) if item["status"] == "missing"]


def _read_store_status(store: HostedConnectionStore) -> dict[str, Any]:
    data = store.read()
    valid_format = isinstance(data, dict) and "_error" not in data
    connections = data.get("connections", {}) if isinstance(data.get("connections", {}), dict) else {}
    pending = data.get("oauth_pending", {}) if isinstance(data.get("oauth_pending", {}), dict) else {}
    return {
        "configured": store.path.exists(),
        "path": str(store.path),
        "readable": "_error" not in data,
        "valid_format": valid_format,
        "version": data.get("version") if isinstance(data, dict) else None,
        "connected_platform_count": len([provider for provider, payload in connections.items() if isinstance(payload, dict) and payload.get("accounts")]),
        "pending_platform_count": len([provider for provider, payload in pending.items() if isinstance(payload, dict) and payload]),
        "error": data.get("_error") if isinstance(data, dict) else "connection_store_invalid_json",
    }


def _token_status(account: dict[str, Any]) -> dict[str, Any]:
    expires_at = account.get("expires_at")
    credentials = account.get("credentials") if isinstance(account.get("credentials"), dict) else {}
    expires_at = expires_at or credentials.get("expires_at")
    if not expires_at:
        return {"status": "unknown", "expires_at": None}
    try:
        expires = datetime.fromisoformat(str(expires_at))
    except ValueError:
        return {"status": "error", "expires_at": str(expires_at), "message": "Invalid expires_at format."}
    return {
        "status": "expired" if datetime.now(timezone.utc) > expires else "active",
        "expires_at": expires.isoformat(),
    }


def _build_registry(provider_configs: dict[str, dict[str, Any]]) -> CapabilityRegistry:
    return CapabilityRegistry(
        {
            "google_ads": GoogleAdsProvider(config=provider_configs["google_ads"]),
            "meta_ads": MetaAdsProvider(config=provider_configs["meta_ads"]),
            "tiktok_ads": TikTokAdsProvider(config=provider_configs["tiktok_ads"]),
            "yandex_direct": YandexDirectProvider(config=provider_configs["yandex_direct"]),
        }
    )


def _check_payload(status: str, message: str, **extra: Any) -> dict[str, Any]:
    payload = {"status": status, "message": message}
    payload.update(extra)
    return payload


class DiagnosticsService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()
        self.store = HostedConnectionStore(self.settings.connection_store_file)
        self.hosted = HostedConnectionService(self.settings)

    def overview(self, *, live: bool = False) -> dict[str, Any]:
        platforms = self.platforms(live=live)
        mcp = self.mcp()
        connections = self.connections()
        missing_env = sorted({env for platform in platforms["platforms"] for env in platform.get("missing_required_env", [])})
        issues = [
            issue
            for platform in platforms["platforms"]
            for issue in platform.get("issues", [])
        ]
        if not connections["storage"]["valid_format"]:
            issues.append("tokens/connections.json is missing or invalid.")
        if missing_env:
            issues.append("Required OAuth env variables are missing.")
        status = "ok"
        if any(platform.get("status") in {"api_error", "token_expired", "env_missing"} for platform in platforms["platforms"]):
            status = "degraded"
        if not any(platform.get("account_count", 0) for platform in platforms["platforms"]):
            status = "needs_setup"
        return {
            "status": status,
            "generated_at": _now_iso(),
            "backend": {
                "status": "ok",
                "environment": self.settings.env,
                "web_api_auth_required": bool(self.settings.web_api_token.strip()) or is_strict_auth_env(self.settings.env) or is_network_exposed_host(self.settings.web_host),
                "preview_only": self.settings.preview_only,
            },
            "mcp": mcp,
            "connections": connections,
            "security": self.security(),
            "platforms": platforms["platforms"],
            "missing_required_env": missing_env,
            "issues": issues,
            "next_actions": self._next_actions(platforms["platforms"], missing_env),
        }

    def readiness(self) -> dict[str, Any]:
        issues: list[str] = []
        checks: dict[str, Any] = {}

        token_required = bool(self.settings.web_api_token.strip()) or is_strict_auth_env(self.settings.env) or is_network_exposed_host(self.settings.web_host)
        token_configured = bool(self.settings.web_api_token.strip())
        checks["backend"] = {"status": "ok", "environment": self.settings.env}
        checks["beta_token"] = {
            "status": "ok" if (not token_required or token_configured) else "error",
            "required": token_required,
            "configured": token_configured,
        }
        if token_required and not token_configured:
            issues.append("AD_MCP_WEB_API_TOKEN is required for this deployment.")

        checks["preview_only"] = {"status": "ok" if self.settings.preview_only else "error", "enabled": self.settings.preview_only}
        if not self.settings.preview_only:
            issues.append("AD_MCP_PREVIEW_ONLY must stay true for beta.")

        connections = self.connections()
        storage = connections["storage"]
        storage_ok = bool(storage.get("readable") and storage.get("valid_format"))
        checks["storage"] = {
            "status": "ok" if storage_ok else "error",
            "configured": storage.get("configured"),
            "readable": storage.get("readable"),
            "valid_format": storage.get("valid_format"),
            "path": storage.get("path"),
        }
        if not storage_ok:
            issues.append("Connection storage is missing, unreadable, or invalid.")

        mcp = self.mcp()
        mcp_ready = mcp.get("status") == "ready"
        checks["mcp_transport"] = {
            "status": "ok" if mcp_ready else "error",
            "transport_status": mcp.get("transport", {}).get("status"),
            "url": mcp.get("transport", {}).get("url"),
            "endpoint_path": mcp.get("transport", {}).get("endpoint_path"),
            "auth_required": mcp.get("transport", {}).get("auth_required"),
            "token_configured": mcp.get("transport", {}).get("token_configured"),
        }
        if not mcp_ready:
            issues.append("Hosted MCP transport is not ready.")

        diagnostics_ok = not issues
        checks["diagnostics"] = {"status": "ok" if diagnostics_ok else "degraded"}
        return {
            "status": "ready" if not issues else "not_ready",
            "generated_at": _now_iso(),
            "checks": checks,
            "issues": issues,
        }

    def platforms(self, *, live: bool = False) -> dict[str, Any]:
        provider_configs, provider_sources = load_runtime_provider_configs(self.settings)
        registry = _build_registry(provider_configs)
        oauth = self.hosted.oauth_diagnostics()
        oauth_by_provider = {item["provider"]: item for item in oauth.get("providers", [])}
        return {
            "status": "ok",
            "live_checks": live,
            "platforms": [
                self.platform(platform.provider, live=live, provider_configs=provider_configs, provider_sources=provider_sources, registry=registry, oauth=oauth_by_provider.get(platform.provider, {}))
                for platform in PLATFORMS
                if platform.provider in PROVIDER_NAMES
            ],
        }

    def platform(
        self,
        provider: str,
        *,
        live: bool = False,
        provider_configs: dict[str, dict[str, Any]] | None = None,
        provider_sources: dict[str, str] | None = None,
        registry: CapabilityRegistry | None = None,
        oauth: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if provider not in PROVIDER_NAMES:
            raise ValueError(f"Unsupported provider: {provider}")
        provider_configs = provider_configs or load_runtime_provider_configs(self.settings)[0]
        provider_sources = provider_sources or load_runtime_provider_configs(self.settings)[1]
        registry = registry or _build_registry(provider_configs)
        oauth = oauth or self.hosted.oauth_diagnostics(provider)["providers"][0]
        config = provider_configs.get(provider, {"accounts": []})
        accounts = [account for account in config.get("accounts", []) if isinstance(account, dict)]
        safe_accounts = [safe_account_summary(account) | {"token_status": _token_status(account)} for account in accounts]
        pending = self.store.pending_selections(provider)
        missing_required = _missing_env(self.settings, provider)
        issues: list[str] = []
        if missing_required:
            issues.append("OAuth env is missing.")
        if pending:
            issues.append("OAuth account selection is pending or expired.")
        if not accounts:
            issues.append("No accounts selected.")
        account_checks = [self._account_checks(registry, provider, account, live=live) for account in accounts]
        latest_error = self._latest_error(provider, pending, account_checks)
        last_successful_update = self._last_successful_update(provider, account_checks)
        status = self._platform_status(missing_required, accounts, pending, account_checks)
        return {
            "provider": provider,
            "label": next((platform.label for platform in PLATFORMS if platform.provider == provider), provider),
            "status": status,
            "source": provider_sources.get(provider, "empty"),
            "oauth": oauth,
            "missing_required_env": missing_required,
            "required_env": _env_status(self.settings, OAUTH_REQUIRED_ENV.get(provider, ())),
            "optional_env": _env_status(self.settings, OAUTH_OPTIONAL_ENV.get(provider, ())),
            "account_count": len(accounts),
            "accounts": safe_accounts,
            "pending_selections": pending,
            "account_checks": account_checks,
            "last_successful_update": last_successful_update,
            "last_error": latest_error,
            "issues": issues,
            "actions": {
                "reconnect": f"/api/hosted/oauth/{OAUTH_PROVIDER_SLUGS[provider]}/start",
                "run_diagnostics": f"/api/diagnostics/platforms/{provider}?live=1",
            },
        }

    def connections(self) -> dict[str, Any]:
        store_status = _read_store_status(self.store)
        provider_configs, provider_sources = load_runtime_provider_configs(self.settings)
        return {
            "status": "ok" if store_status["valid_format"] else "error",
            "storage": store_status,
            "sources": provider_sources,
            "platforms": [
                {
                    "provider": provider,
                    "source": provider_sources.get(provider, "empty"),
                    "account_count": len(provider_configs.get(provider, {}).get("accounts", [])),
                    "accounts": [safe_account_summary(account) for account in provider_configs.get(provider, {}).get("accounts", [])],
                    "pending_selections": self.store.pending_selections(provider),
                }
                for provider in PROVIDER_NAMES
            ],
        }

    def security(self) -> dict[str, Any]:
        connections = self.connections()
        storage = connections["storage"]
        mcp = self.mcp()
        return {
            "status": "ok" if self.settings.preview_only and bool(self.settings.web_api_token.strip()) else "needs_attention",
            "beta_token_configured": bool(self.settings.web_api_token.strip()),
            "api_auth_required": bool(self.settings.web_api_token.strip()) or is_strict_auth_env(self.settings.env) or is_network_exposed_host(self.settings.web_host),
            "preview_only": self.settings.preview_only,
            "live_writes_enabled": False,
            "storage_path_configured": bool(str(self.settings.connection_store_path).strip()),
            "connections_storage_accessible": bool(storage.get("readable") and storage.get("valid_format")),
            "public_mcp_url_configured": bool(self.settings.public_base_url.strip() or self.settings.mcp_public_url.strip()),
            "dangerous_debug_mode_enabled": False,
            "secrets_redacted": True,
            "tokens_returned": False,
            "smtp_configured": self.settings.smtp_configured,
            "profile_editing_enabled": True,
            "avatar_upload_enabled": True,
            "password_reset_enabled": self.settings.smtp_configured,
            "password_change_enabled": True,
            "auth_secure_cookies": self.settings.auth_secure_cookies,
            "public_registration_enabled": self.settings.auth_allow_public_registration,
            "auth_rate_limit_enabled": self.settings.auth_rate_limit_window_seconds > 0,
            "auth_rate_limit_window_seconds": self.settings.auth_rate_limit_window_seconds,
            "cors_policy": "same-origin",
            "cache_control": "no-store",
            "oauth_provider_env_present": {
                provider: {
                    item["name"]: item["status"]
                    for item in _env_status(self.settings, OAUTH_REQUIRED_ENV.get(provider, ()))
                }
                for provider in PROVIDER_NAMES
            },
            "mcp_transport": {
                "auth_required": mcp.get("transport", {}).get("auth_required"),
                "token_configured": mcp.get("transport", {}).get("token_configured"),
            },
        }

    def mcp(self) -> dict[str, Any]:
        info = self.hosted.mcp_connection_info()
        missing_tools: list[str] = []
        auth_required = bool(self.settings.web_api_token.strip()) or is_strict_auth_env(self.settings.env) or is_network_exposed_host(self.settings.mcp_http_host)
        token_configured = bool(self.settings.web_api_token.strip())
        transport_status = "available" if (not auth_required or token_configured) else "auth_missing"
        return {
            "status": "ready" if transport_status == "available" else "degraded",
            "transport": {
                "status": transport_status,
                "type": info["transport"],
                "url": info["url"],
                "endpoint_path": info["endpoint_path"],
                "auth_required": auth_required,
                "token_configured": token_configured,
            },
            "tools": {
                "ready": list(CORE_MCP_TOOLS),
                "not_ready": missing_tools,
                "preview_only": self.settings.preview_only,
            },
            "message": "Hosted MCP transport is configured. Use the MCP URL with bearer auth in a compatible client.",
        }

    def beta_capabilities(self) -> dict[str, Any]:
        platforms = self.platforms(live=False)["platforms"]
        mcp = self.mcp()
        security = self.security()
        return {
            "status": "ok",
            "mode": "hosted_beta",
            "service": "HolyMedia MCP",
            "scope": {
                "client_model": "hosted_dashboard_oauth_plus_hosted_mcp",
                "customer_local_setup_required": False,
                "primary_platforms": ["meta_ads", "google_ads"],
                "limited_platforms": [
                    {
                        "provider": "tiktok_ads",
                        "status": "limited_beta",
                        "note": "OAuth onboarding is available; campaign and metrics reads may return not_available until live provider support is completed.",
                    },
                    {
                        "provider": "yandex_direct",
                        "status": "limited_beta",
                        "note": "OAuth onboarding is available; campaign and metrics reads may return not_available until live provider support is completed.",
                    },
                ],
            },
            "platforms": [
                {
                    "provider": platform["provider"],
                    "label": platform["label"],
                    "status": platform["status"],
                    "account_count": platform["account_count"],
                    "oauth_start_endpoint": platform["actions"]["reconnect"],
                    "diagnostics_endpoint": platform["actions"]["run_diagnostics"],
                }
                for platform in platforms
            ],
            "mcp": {
                "transport": mcp["transport"]["type"],
                "url": mcp["transport"]["url"],
                "endpoint_path": mcp["transport"]["endpoint_path"],
                "auth_required": mcp["transport"]["auth_required"],
                "tools": mcp["tools"]["ready"],
            },
            "preview_only": {
                "enabled": self.settings.preview_only,
                "live_writes_enabled": False,
                "write_actions": "preview_only",
            },
            "security": {
                "beta_token_required": security["api_auth_required"],
                "beta_token_configured": security["beta_token_configured"],
                "mcp_public_url_configured": security["public_mcp_url_configured"],
                "secrets_redacted": True,
                "tokens_returned": False,
                "cache_control": security["cache_control"],
                "auth_rate_limit_enabled": security["auth_rate_limit_enabled"],
            },
            "account": {
                "profile_editing_enabled": True,
                "avatar_upload_enabled": True,
                "password_change_enabled": True,
                "password_reset_enabled": self.settings.smtp_configured,
                "smtp_configured": self.settings.smtp_configured,
                "public_registration_enabled": self.settings.auth_allow_public_registration,
            },
            "diagnostics": {
                "overview": "/api/diagnostics",
                "platforms": "/api/diagnostics/platforms",
                "connections": "/api/diagnostics/connections",
                "mcp": "/api/diagnostics/mcp",
                "security": "/api/diagnostics/security",
            },
        }

    def mcp_tool_summary(self, *, live: bool = False) -> dict[str, Any]:
        overview = self.overview(live=live)
        platforms = overview["platforms"]
        connected = [platform for platform in platforms if platform["account_count"]]
        tools_not_ready: list[str] = []
        if not connected:
            tools_not_ready.extend(["list_campaigns", "get_basic_metrics", "preview_*"])
        for platform in platforms:
            if platform["status"] in {"env_missing", "not_connected", "no_accounts_selected", "reconnect_required", "token_expired", "api_error"}:
                tools_not_ready.append(f"{platform['provider']}: live reads")
        return {
            "status": overview["status"],
            "generated_at": overview["generated_at"],
            "connected_platforms": [
                {"provider": platform["provider"], "account_count": platform["account_count"], "accounts": platform["accounts"]}
                for platform in connected
            ],
            "tools_ready": overview["mcp"]["tools"]["ready"],
            "tools_not_ready": sorted(set(tools_not_ready)),
            "missing_required_env": overview["missing_required_env"],
            "errors_to_fix": overview["issues"],
            "next_actions": overview["next_actions"],
            "security": {
                "secrets_redacted": True,
                "preview_only": self.settings.preview_only,
                "tokens_returned": False,
            },
        }

    def _account_checks(self, registry: CapabilityRegistry, provider: str, account: dict[str, Any], *, live: bool) -> dict[str, Any]:
        account_id = str(account.get("account_id") or account.get("customer_id") or account.get("advertiser_id") or "")
        checks: dict[str, Any] = {
            "account_id": account_id,
            "credentials_present": bool(safe_account_summary(account).get("credentials_present")),
            "token": _token_status(account),
            "accounts_list": _check_payload("ok", "Account is selected in hosted connection storage."),
            "campaigns": _check_payload("skipped", "Pass live=1 to run a safe provider campaign read."),
            "metrics": _check_payload("skipped", "Pass live=1 to run a safe provider metrics read."),
        }
        if checks["token"]["status"] == "expired":
            checks["campaigns"] = _check_payload("token_expired", "Stored token is expired. Reconnect the platform.")
            checks["metrics"] = _check_payload("token_expired", "Stored token is expired. Reconnect the platform.")
            return checks
        if not live:
            return checks
        provider_client = registry.get_provider(provider)
        try:
            campaign_payload = provider_client.list_account_objects(account_id, "campaign", limit=1)
            if campaign_payload.get("status") == "unsupported":
                checks["campaigns"] = _check_payload("not_available", campaign_payload.get("message", "Campaign read is not implemented."))
            else:
                checks["campaigns"] = _check_payload("ok", "Campaign list read succeeded.", row_count=campaign_payload.get("row_count", len(campaign_payload.get("rows", []))))
        except Exception as exc:  # noqa: BLE001
            checks["campaigns"] = self._error_check(exc)
        try:
            yesterday = date.today() - timedelta(days=1)
            response = provider_client.get_report(
                ReportRequest(
                    provider=provider,  # type: ignore[arg-type]
                    account_id=account_id,
                    entity_level="account",
                    date_range=DateRange(start_date=yesterday.isoformat(), end_date=yesterday.isoformat()),
                    fields=["spend", "impressions", "clicks", "ctr", "conversions"],
                )
            )
            if response.preview:
                checks["metrics"] = _check_payload("not_available", "Real metrics are not implemented for this platform yet.")
            else:
                checks["metrics"] = _check_payload("ok", "Basic metrics read succeeded.", row_count=len(response.rows))
        except Exception as exc:  # noqa: BLE001
            checks["metrics"] = self._error_check(exc)
        return checks

    def _error_check(self, exc: Exception) -> dict[str, Any]:
        normalized = normalize_error(exc)
        normalized["message"] = _redact(normalized["message"])
        return {"status": normalized["code"], "message": normalized["message"], "error": normalized}

    def _platform_status(self, missing_required: list[str], accounts: list[dict[str, Any]], pending: list[dict[str, Any]], checks: list[dict[str, Any]]) -> str:
        if missing_required:
            return "env_missing"
        if any(item.get("status") == "pending_account_selection" for item in pending):
            return "pending_account_selection"
        if any(item.get("status") == "expired" for item in pending):
            return "reconnect_required"
        if not accounts:
            return "not_connected"
        if any(check.get("token", {}).get("status") == "expired" for check in checks):
            return "token_expired"
        if any(check.get("campaigns", {}).get("status") not in {"ok", "skipped", "not_available"} for check in checks):
            return "api_error"
        return "mcp_ready"

    def _latest_error(self, provider: str, pending: list[dict[str, Any]], checks: list[dict[str, Any]]) -> dict[str, Any] | None:
        for check in checks:
            for key in ("campaigns", "metrics"):
                payload = check.get(key, {})
                if payload.get("status") not in {None, "ok", "skipped", "not_available"}:
                    return {"provider": provider, "check": key, "status": payload.get("status"), "message": payload.get("message")}
        for item in pending:
            if item.get("status") == "expired":
                return {"provider": provider, "check": "oauth_pending", "status": "expired", "message": "OAuth pending selection expired."}
        return None

    def _last_successful_update(self, provider: str, checks: list[dict[str, Any]]) -> str | None:
        if any(check.get("campaigns", {}).get("status") == "ok" or check.get("metrics", {}).get("status") == "ok" for check in checks):
            return _now_iso()
        data = self.store.read()
        connection = (data.get("connections", {}) if isinstance(data.get("connections", {}), dict) else {}).get(provider, {})
        if isinstance(connection, dict):
            return connection.get("updated_at") or connection.get("created_at")
        return None

    def _next_actions(self, platforms: list[dict[str, Any]], missing_env: list[str]) -> list[str]:
        actions: list[str] = []
        if missing_env:
            actions.append("Set missing AD_MCP_* OAuth env variables on the server and restart the web/MCP processes.")
        for platform in platforms:
            if platform["status"] in {"not_connected", "env_missing"}:
                actions.append(f"Configure and reconnect {platform['label']} from the dashboard.")
            elif platform["status"] in {"pending_account_selection"}:
                actions.append(f"Open Connections and select accounts for {platform['label']}.")
            elif platform["status"] in {"token_expired", "reconnect_required"}:
                actions.append(f"Reconnect {platform['label']} OAuth.")
            elif platform["status"] == "api_error":
                actions.append(f"Open {platform['label']} diagnostics and review the provider API error.")
        if not actions:
            actions.append("Connect the hosted MCP URL in Codex/Claude and run list_ad_accounts.")
        return sorted(set(actions))

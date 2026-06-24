from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from ad_mcp.core.config_loader import load_provider_from_connections
from ad_mcp.runtime_context import current_workspace_id

if TYPE_CHECKING:
    from ad_mcp.settings import Settings


PROVIDER_NAMES = ("google_ads", "meta_ads", "tiktok_ads", "yandex_direct")

SECRET_KEYS = {
    "access_token",
    "app_secret",
    "client_secret",
    "developer_token",
    "oauth_client_secret",
    "refresh_token",
    "secret",
}

SAFE_ACCOUNT_KEYS = (
    "name",
    "account_id",
    "customer_id",
    "login_customer_id",
    "manager_customer_id",
    "google_ads_account_type",
    "google_ads_level",
    "google_ads_status",
    "advertiser_id",
    "login",
    "agency_login",
    "direct_client_login",
    "app_name",
    "app_id",
    "verification_status",
    "api_access_status",
    "api_points",
    "scope",
    "currency",
    "timezone_name",
    "yandex_archived",
    "selection_disabled",
    "disabled_reason",
    "status",
)

SAFE_ACCOUNT_LIST_KEYS = ("requested_permissions",)


def safe_account_summary(account: dict[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key in SAFE_ACCOUNT_KEYS:
        value = account.get(key)
        if value is not None:
            safe[key] = str(value)
    for key in SAFE_ACCOUNT_LIST_KEYS:
        value = account.get(key)
        if isinstance(value, list):
            safe[key] = [str(item) for item in value]
    credentials = account.get("credentials") if isinstance(account.get("credentials"), dict) else {}
    safe["credentials_present"] = any(account.get(key) for key in SECRET_KEYS) or any(credentials.get(key) for key in SECRET_KEYS)
    return safe


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")) or {}
    except (OSError, json.JSONDecodeError):
        return {"_error": "connection_store_unreadable"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expires_iso(ttl_seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=max(1, ttl_seconds))).isoformat()


def _normalize_account(provider: str, account: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(account)
    if provider == "google_ads" and not normalized.get("account_id") and normalized.get("customer_id"):
        normalized["account_id"] = normalized["customer_id"]
    if provider == "tiktok_ads" and not normalized.get("account_id") and normalized.get("advertiser_id"):
        normalized["account_id"] = normalized["advertiser_id"]
    return normalized


def _runtime_account(provider: str, account: dict[str, Any]) -> dict[str, Any]:
    account = _normalize_account(provider, account)
    credentials = account.get("credentials") if isinstance(account.get("credentials"), dict) else {}
    flattened = {key: value for key, value in account.items() if key != "credentials"}
    flattened.update(credentials)
    return flattened


def _stored_account(provider: str, account: dict[str, Any]) -> dict[str, Any]:
    account = _normalize_account(provider, account)
    stored: dict[str, Any] = {}
    credentials: dict[str, Any] = {}
    for key, value in account.items():
        if key in SECRET_KEYS:
            credentials[key] = value
        else:
            stored[key] = value
    existing_credentials = account.get("credentials")
    if isinstance(existing_credentials, dict):
        credentials.update(existing_credentials)
    if credentials:
        stored["credentials"] = credentials
    return stored


def _safe_pending_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    safe: dict[str, Any] = {}
    for key, value in metadata.items():
        if key in SECRET_KEYS:
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            safe[str(key)] = value
        elif isinstance(value, list):
            safe[str(key)] = [
                item
                for item in value
                if isinstance(item, (str, int, float, bool)) or item is None
            ]
    return safe


def _account_selection_disabled(account: dict[str, Any]) -> bool:
    if bool(account.get("selection_disabled")):
        return True
    return str(account.get("yandex_archived") or "").strip().upper() == "YES"


def _clean_scope_id(value: str | None) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _scope_root(data: dict[str, Any], workspace_id: str | None = None, *, create: bool = False) -> dict[str, Any]:
    clean_workspace = _clean_scope_id(workspace_id)
    if not clean_workspace:
        return data
    workspaces = data.setdefault("workspaces", {}) if create else data.get("workspaces", {})
    if not isinstance(workspaces, dict):
        if not create:
            return {}
        workspaces = {}
        data["workspaces"] = workspaces
    workspace = workspaces.setdefault(clean_workspace, {}) if create else workspaces.get(clean_workspace, {})
    if not isinstance(workspace, dict):
        if not create:
            return {}
        workspace = {}
        workspaces[clean_workspace] = workspace
    workspace["workspace_id"] = clean_workspace
    return workspace


class HostedConnectionStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def read(self) -> dict[str, Any]:
        return _read_json(self.path)

    def status(self) -> dict[str, Any]:
        data = self.read()
        return {
            "configured": self.path.exists(),
            "path": str(self.path),
            "readable": "_error" not in data,
            "version": data.get("version") if isinstance(data, dict) else None,
        }

    def provider_config(self, provider: str, workspace_id: str | None = None) -> dict[str, Any]:
        data = self.read()
        root = _scope_root(data, workspace_id)
        connection = (root.get("connections", {}) if isinstance(root.get("connections", {}), dict) else {}).get(provider, {})
        if not isinstance(connection, dict):
            return {"provider": provider, "accounts": []}
        config = {key: value for key, value in connection.items() if key not in {"accounts", "created_at", "updated_at", "source"}}
        config["provider"] = provider
        accounts = connection.get("accounts", [])
        config["accounts"] = [_runtime_account(provider, account) for account in accounts if isinstance(account, dict)]
        return config

    def safe_provider_status(self, provider: str, workspace_id: str | None = None) -> dict[str, Any]:
        config = self.provider_config(provider, workspace_id=workspace_id)
        return {
            "provider": provider,
            "accounts": [safe_account_summary(account) for account in config.get("accounts", [])],
        }

    def pending_selections(self, provider: str, workspace_id: str | None = None) -> list[dict[str, Any]]:
        data = self.read()
        root = _scope_root(data, workspace_id)
        provider_pending = (
            root.get("oauth_pending", {})
            if isinstance(root.get("oauth_pending", {}), dict)
            else {}
        ).get(provider, {})
        if not isinstance(provider_pending, dict):
            return []
        selections: list[dict[str, Any]] = []
        for pending_id, pending in provider_pending.items():
            if not isinstance(pending, dict):
                continue
            accounts = pending.get("accounts", [])
            expired = self._pending_expired(pending)
            selections.append(
                {
                    "provider": provider,
                    "pending_id": str(pending_id),
                    "status": "expired" if expired else "pending_account_selection",
                    "expires_at": pending.get("expires_at"),
                    "metadata": _safe_pending_metadata(pending.get("metadata")),
                    "accounts": [
                        safe_account_summary(_runtime_account(provider, account))
                        for account in accounts
                        if isinstance(account, dict)
                    ],
                }
            )
        return selections

    def disconnect_provider(self, provider: str, workspace_id: str | None = None) -> dict[str, Any]:
        if provider not in PROVIDER_NAMES:
            raise ValueError(f"Unsupported provider: {provider}")
        data = self.read()
        if "_error" in data:
            data = {}
        root = _scope_root(data, workspace_id, create=True)
        connections = root.get("connections", {}) if isinstance(root.get("connections", {}), dict) else {}
        pending_root = root.get("oauth_pending", {}) if isinstance(root.get("oauth_pending", {}), dict) else {}
        connections.pop(provider, None)
        pending_root.pop(provider, None)
        root["connections"] = connections
        root["oauth_pending"] = pending_root
        data["version"] = int(data.get("version") or 1)
        self._write(data)
        return self.safe_provider_status(provider, workspace_id=workspace_id)

    def save_provider_config(
        self,
        provider: str,
        provider_config: dict[str, Any],
        source: str = "dashboard_oauth",
        workspace_id: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        if provider not in PROVIDER_NAMES:
            raise ValueError(f"Unsupported provider: {provider}")
        data = self.read()
        if "_error" in data:
            data = {}
        root = _scope_root(data, workspace_id, create=True)
        connections = root.setdefault("connections", {})
        if not isinstance(connections, dict):
            connections = {}
            root["connections"] = connections
        previous = connections.get(provider, {}) if isinstance(connections.get(provider, {}), dict) else {}
        stored = {key: value for key, value in provider_config.items() if key not in {"accounts"}}
        stored["provider"] = provider
        stored["source"] = source
        if _clean_scope_id(workspace_id):
            stored["workspace_id"] = _clean_scope_id(workspace_id)
        if _clean_scope_id(user_id):
            stored["user_id"] = _clean_scope_id(user_id)
        stored["created_at"] = previous.get("created_at") or _now_iso()
        stored["updated_at"] = _now_iso()
        stored["accounts"] = [_stored_account(provider, account) for account in provider_config.get("accounts", []) if isinstance(account, dict)]
        connections[provider] = stored
        data["version"] = int(data.get("version") or 1)
        self._write(data)
        return self.safe_provider_status(provider, workspace_id=workspace_id)

    def save_oauth_pending(
        self,
        provider: str,
        accounts: list[dict[str, Any]],
        credentials: dict[str, Any],
        ttl_seconds: int = 900,
        source: str = "dashboard_oauth",
        workspace_id: str | None = None,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if provider not in PROVIDER_NAMES:
            raise ValueError(f"Unsupported provider: {provider}")
        data = self.read()
        if "_error" in data:
            data = {}
        root = _scope_root(data, workspace_id, create=True)
        pending_root = root.setdefault("oauth_pending", {})
        if not isinstance(pending_root, dict):
            pending_root = {}
            root["oauth_pending"] = pending_root
        provider_pending = pending_root.setdefault(provider, {})
        if not isinstance(provider_pending, dict):
            provider_pending = {}
            pending_root[provider] = provider_pending
        pending_id = uuid4().hex
        stored_accounts = [_stored_account(provider, account) for account in accounts if isinstance(account, dict)]
        provider_pending[pending_id] = {
            "provider": provider,
            "source": source,
            "workspace_id": _clean_scope_id(workspace_id),
            "user_id": _clean_scope_id(user_id),
            "created_at": _now_iso(),
            "expires_at": _expires_iso(ttl_seconds),
            "credentials": dict(credentials),
            "metadata": _safe_pending_metadata(metadata),
            "accounts": stored_accounts,
        }
        data["version"] = int(data.get("version") or 1)
        self._write(data)
        return self.pending_selection(provider, pending_id, workspace_id=workspace_id)

    def save_oauth_state(
        self,
        provider: str,
        state_id: str,
        ttl_seconds: int = 900,
        workspace_id: str | None = None,
        user_id: str | None = None,
    ) -> None:
        if provider not in PROVIDER_NAMES:
            raise ValueError(f"Unsupported provider: {provider}")
        if not state_id:
            raise ValueError("OAuth state id is required.")
        data = self.read()
        if "_error" in data:
            data = {}
        root = _scope_root(data, workspace_id, create=True)
        state_root = root.setdefault("oauth_states", {})
        if not isinstance(state_root, dict):
            state_root = {}
            root["oauth_states"] = state_root
        provider_states = state_root.setdefault(provider, {})
        if not isinstance(provider_states, dict):
            provider_states = {}
            state_root[provider] = provider_states
        for expired_id in [key for key, record in provider_states.items() if not isinstance(record, dict) or self._pending_expired(record)]:
            provider_states.pop(expired_id, None)
        provider_states[state_id] = {
            "provider": provider,
            "workspace_id": _clean_scope_id(workspace_id),
            "user_id": _clean_scope_id(user_id),
            "created_at": _now_iso(),
            "expires_at": _expires_iso(ttl_seconds),
        }
        data["version"] = int(data.get("version") or 1)
        self._write(data)

    def consume_oauth_state(self, provider: str, state_id: str, workspace_id: str | None = None) -> None:
        if provider not in PROVIDER_NAMES:
            raise ValueError(f"Unsupported provider: {provider}")
        data = self.read()
        root = _scope_root(data, workspace_id)
        state_root = root.get("oauth_states", {}) if isinstance(root.get("oauth_states", {}), dict) else {}
        provider_states = state_root.get(provider, {}) if isinstance(state_root.get(provider, {}), dict) else {}
        record = provider_states.get(state_id)
        if not isinstance(record, dict):
            raise ValueError("OAuth state was not found or was already used.")
        if self._pending_expired(record):
            provider_states.pop(state_id, None)
            self._write(data)
            raise ValueError("OAuth state expired.")
        provider_states.pop(state_id, None)
        self._write(data)

    def pending_selection(self, provider: str, pending_id: str, workspace_id: str | None = None) -> dict[str, Any]:
        pending = self._pending(provider, pending_id, workspace_id=workspace_id)
        accounts = pending.get("accounts", [])
        return {
            "provider": provider,
            "pending_id": pending_id,
            "status": "pending_account_selection",
            "expires_at": pending.get("expires_at"),
            "metadata": _safe_pending_metadata(pending.get("metadata")),
            "accounts": [safe_account_summary(_runtime_account(provider, account)) for account in accounts if isinstance(account, dict)],
        }

    def select_pending_accounts(
        self,
        provider: str,
        pending_id: str,
        account_ids: list[str],
        workspace_id: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        selected_ids = {str(account_id).strip() for account_id in account_ids if str(account_id).strip()}
        if not selected_ids:
            raise ValueError("At least one account_id must be selected.")
        pending = self._pending(provider, pending_id, workspace_id=workspace_id)
        credentials = pending.get("credentials", {}) if isinstance(pending.get("credentials"), dict) else {}
        selected_accounts: list[dict[str, Any]] = []
        for stored_account in pending.get("accounts", []):
            if not isinstance(stored_account, dict):
                continue
            runtime_account = _runtime_account(provider, stored_account)
            account_id = str(runtime_account.get("account_id", "") or "").strip()
            if account_id in selected_ids and not _account_selection_disabled(runtime_account):
                account = dict(runtime_account)
                account.update(credentials)
                account["status"] = account.get("status") or "connected"
                selected_accounts.append(account)
        if not selected_accounts:
            raise ValueError("Selected account_ids were not found in pending OAuth discovery.")
        status = self.save_provider_config(
            provider,
            {"provider": provider, "accounts": selected_accounts},
            source="dashboard_oauth",
            workspace_id=workspace_id,
            user_id=user_id,
        )
        # Completing an OAuth selection makes older pending records for the same provider stale.
        self._remove_all_pending(provider, workspace_id=workspace_id)
        return {"provider": provider, "status": "connected", "accounts": status["accounts"]}

    def _pending(self, provider: str, pending_id: str, workspace_id: str | None = None) -> dict[str, Any]:
        data = self.read()
        root = _scope_root(data, workspace_id)
        pending = (
            root.get("oauth_pending", {})
            if isinstance(root.get("oauth_pending", {}), dict)
            else {}
        ).get(provider, {})
        record = pending.get(pending_id) if isinstance(pending, dict) else None
        if not isinstance(record, dict):
            raise ValueError("OAuth pending selection was not found.")
        if self._pending_expired(record):
            self._remove_pending(provider, pending_id, workspace_id=workspace_id)
            raise ValueError("OAuth pending selection expired.")
        return record

    def _pending_expired(self, record: dict[str, Any]) -> bool:
        expires_at = record.get("expires_at")
        if not expires_at:
            return False
        try:
            return datetime.now(timezone.utc) > datetime.fromisoformat(str(expires_at))
        except ValueError:
            return True

    def _remove_pending(self, provider: str, pending_id: str, workspace_id: str | None = None) -> None:
        data = self.read()
        root = _scope_root(data, workspace_id)
        pending_root = root.get("oauth_pending", {}) if isinstance(root.get("oauth_pending", {}), dict) else {}
        provider_pending = pending_root.get(provider, {}) if isinstance(pending_root.get(provider, {}), dict) else {}
        provider_pending.pop(pending_id, None)
        self._write(data)

    def _remove_all_pending(self, provider: str, workspace_id: str | None = None) -> None:
        data = self.read()
        root = _scope_root(data, workspace_id)
        pending_root = root.get("oauth_pending", {}) if isinstance(root.get("oauth_pending", {}), dict) else {}
        if isinstance(pending_root, dict):
            pending_root.pop(provider, None)
            root["oauth_pending"] = pending_root
        self._write(data)

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        tmp_path.replace(self.path)


def load_runtime_provider_configs(
    settings: "Settings",
    workspace_id: str | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    store = HostedConnectionStore(settings.connection_store_file)
    scoped_workspace_id = _clean_scope_id(workspace_id) or current_workspace_id()
    configs: dict[str, dict[str, Any]] = {}
    sources: dict[str, str] = {}
    for provider in PROVIDER_NAMES:
        hosted_config = store.provider_config(provider, workspace_id=scoped_workspace_id)
        if hosted_config.get("accounts"):
            configs[provider] = hosted_config
            sources[provider] = "hosted_connection_store_scoped" if scoped_workspace_id else "hosted_connection_store"
            continue
        if scoped_workspace_id:
            configs[provider] = {"provider": provider, "accounts": []}
            sources[provider] = "empty"
            continue
        if settings.connections_fallback_to_local:
            local_config = load_provider_from_connections(settings.connections_config_path, provider)
            configs[provider] = local_config
            if local_config.get("accounts"):
                sources[provider] = "local_connections_config" if settings.connections_config_path.exists() else "local_connections_example"
            else:
                sources[provider] = "empty"
        else:
            configs[provider] = {"provider": provider, "accounts": []}
            sources[provider] = "empty"
    return configs, sources

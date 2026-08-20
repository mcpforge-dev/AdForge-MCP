from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Iterator


_current_workspace_id: ContextVar[str | None] = ContextVar("ad_mcp_current_workspace_id", default=None)
_current_mcp_access: ContextVar[McpAccessContext | None] = ContextVar("ad_mcp_current_mcp_access", default=None)


@dataclass(frozen=True)
class McpAccessContext:
    token_kind: str
    workspace_id: str | None
    scopes: frozenset[str]
    allowed_accounts: dict[str, frozenset[str]]
    read_only: bool = False
    principal_id: str | None = None

    @property
    def allowed_providers(self) -> frozenset[str]:
        return frozenset(self.allowed_accounts)


def current_workspace_id() -> str | None:
    value = _current_workspace_id.get()
    return value.strip() if isinstance(value, str) and value.strip() else None


def set_current_workspace_id(workspace_id: str | None) -> Token[str | None]:
    clean = workspace_id.strip() if isinstance(workspace_id, str) and workspace_id.strip() else None
    return _current_workspace_id.set(clean)


def reset_current_workspace_id(token: Token[str | None]) -> None:
    _current_workspace_id.reset(token)


def current_mcp_access() -> McpAccessContext | None:
    return _current_mcp_access.get()


def set_current_mcp_access(access: McpAccessContext | None) -> Token[McpAccessContext | None]:
    return _current_mcp_access.set(access)


def reset_current_mcp_access(token: Token[McpAccessContext | None]) -> None:
    _current_mcp_access.reset(token)


def clear_current_mcp_access() -> None:
    set_current_workspace_id(None)
    set_current_mcp_access(None)


def ensure_current_mcp_tool_access(
    *,
    provider: str | None = None,
    account_id: str | None = None,
    write: bool = False,
) -> None:
    access = current_mcp_access()
    if access is None or access.token_kind not in {"service", "legacy"}:
        return
    if write or "adforge:mcp:read" not in access.scopes:
        raise PermissionError("This service token is restricted to read-only MCP tools.")
    clean_provider = str(provider or "").strip()
    if clean_provider and clean_provider not in access.allowed_providers:
        raise PermissionError("This service token cannot access the requested provider.")
    clean_account = str(account_id or "").strip()
    if clean_account and clean_account not in access.allowed_accounts.get(clean_provider, frozenset()):
        raise PermissionError("This service token cannot access the requested advertising account.")


def filter_provider_config_for_current_access(provider: str, config: dict) -> dict:
    access = current_mcp_access()
    if access is None or access.token_kind not in {"service", "legacy"}:
        return config
    allowed_ids = access.allowed_accounts.get(provider)
    if not allowed_ids:
        return {"provider": provider, "accounts": []}
    accounts = []
    for account in config.get("accounts", []) or []:
        identifiers = {
            str(account.get("account_id") or "").strip(),
            str(account.get("customer_id") or "").strip(),
        }
        if identifiers & allowed_ids:
            accounts.append(account)
    return {**config, "provider": provider, "accounts": accounts}


@contextmanager
def workspace_scope(workspace_id: str | None) -> Iterator[None]:
    token = set_current_workspace_id(workspace_id)
    try:
        yield
    finally:
        reset_current_workspace_id(token)


@contextmanager
def mcp_access_scope(access: McpAccessContext | None) -> Iterator[None]:
    workspace_token = set_current_workspace_id(access.workspace_id if access else None)
    access_token = set_current_mcp_access(access)
    try:
        yield
    finally:
        reset_current_mcp_access(access_token)
        reset_current_workspace_id(workspace_token)

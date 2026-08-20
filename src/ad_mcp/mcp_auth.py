from __future__ import annotations

import json
import secrets

from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings

from ad_mcp.settings import Settings, is_network_exposed_host, is_strict_auth_env
from ad_mcp.runtime_context import McpAccessContext, clear_current_mcp_access, set_current_mcp_access, set_current_workspace_id
from ad_mcp.web.auth_store import AuthDatabaseUnavailable, AuthStore


MCP_SCOPE = "adforge:mcp"
MCP_READ_SCOPE = "adforge:mcp:read"


class StaticBearerTokenVerifier:
    def __init__(self, token: str, *, settings: Settings | None = None, auth_store: AuthStore | None = None) -> None:
        self._token = token
        self._settings = settings
        self._auth_store = auth_store

    async def verify_token(self, token: str) -> AccessToken | None:
        clear_current_mcp_access()
        if self._token and secrets.compare_digest(token, self._token):
            if not self._settings or not self._settings.legacy_mcp_token_enabled:
                return None
            workspace_id = self._settings.legacy_mcp_workspace_id.strip()
            try:
                raw_allowed = json.loads(self._settings.legacy_mcp_allowed_accounts_json or "{}")
            except json.JSONDecodeError:
                return None
            if not workspace_id or not isinstance(raw_allowed, dict):
                return None
            allowed_accounts = {
                str(provider): frozenset(str(account_id).strip() for account_id in account_ids if str(account_id).strip())
                for provider, account_ids in raw_allowed.items()
                if isinstance(account_ids, list) and account_ids
            }
            if not allowed_accounts:
                return None
            set_current_workspace_id(workspace_id)
            set_current_mcp_access(
                McpAccessContext(
                    token_kind="legacy",
                    workspace_id=workspace_id,
                    scopes=frozenset({MCP_SCOPE, MCP_READ_SCOPE}),
                    allowed_accounts=allowed_accounts,
                    read_only=True,
                    principal_id="legacy-web-api-token",
                )
            )
            return AccessToken(token=token, client_id="adforge-legacy-scoped-client", scopes=[MCP_SCOPE, MCP_READ_SCOPE])
        if not self._settings:
            return None
        store = self._auth_store or AuthStore(self._settings)
        try:
            store.ensure_schema()
            service = store.verify_mcp_service_token(token)
            if service:
                set_current_workspace_id(service.workspace_id)
                set_current_mcp_access(
                    McpAccessContext(
                        token_kind="service",
                        workspace_id=service.workspace_id,
                        scopes=frozenset({service.scope}),
                        allowed_accounts=service.allowed_accounts,
                        read_only=True,
                        principal_id=service.id,
                    )
                )
                return AccessToken(
                    token=token,
                    client_id=f"adforge-service:{service.id}",
                    scopes=[MCP_SCOPE, MCP_READ_SCOPE],
                )
            user = store.verify_mcp_token(token)
            if not user:
                user = store.verify_mcp_oauth_access_token(token)
        except (AuthDatabaseUnavailable, RuntimeError):
            return None
        if not user:
            return None
        set_current_workspace_id(user.workspace_id)
        set_current_mcp_access(
            McpAccessContext(
                token_kind="user",
                workspace_id=user.workspace_id,
                scopes=frozenset({MCP_SCOPE}),
                allowed_accounts={},
                principal_id=user.id,
            )
        )
        return AccessToken(token=token, client_id=f"adforge-user:{user.id}", scopes=[MCP_SCOPE])


def mcp_token_required(settings: Settings) -> bool:
    return bool(settings.web_api_token.strip()) or is_strict_auth_env(settings.env) or is_network_exposed_host(settings.mcp_http_host)


def build_mcp_auth(settings: Settings) -> tuple[AuthSettings | None, StaticBearerTokenVerifier | None]:
    if not mcp_token_required(settings):
        return None, None
    token = settings.web_api_token.strip()
    if not token:
        raise RuntimeError(
            "AD_MCP_WEB_API_TOKEN is required for hosted MCP when staging, beta, production, or network-exposed."
        )
    issuer_url = settings.public_base_or_local_mcp_url
    resource_server_url = settings.public_mcp_url
    return (
        AuthSettings(
            issuer_url=issuer_url,
            resource_server_url=resource_server_url,
            required_scopes=[MCP_SCOPE],
        ),
        StaticBearerTokenVerifier(token, settings=settings),
    )

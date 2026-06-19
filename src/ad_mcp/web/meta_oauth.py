from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from typing import Any
from urllib.parse import urlencode
from uuid import uuid4

import httpx

from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.core.errors import OAuthError
from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.settings import Settings


META_PROVIDER = "meta_ads"


class MetaOAuthError(OAuthError):
    pass


def _redact_oauth_error(text: str) -> str:
    return redact_secret_text(text)


def _b64_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _b64_decode(payload: str) -> bytes:
    padding = "=" * (-len(payload) % 4)
    return base64.urlsafe_b64decode(f"{payload}{padding}".encode("ascii"))


class MetaOAuthService:
    def __init__(self, settings: Settings | None = None, http_client: httpx.Client | None = None) -> None:
        self._settings = settings or Settings()
        self._store = HostedConnectionStore(self._settings.connection_store_file)
        self._http_client = http_client

    def configured(self) -> bool:
        return bool(self._settings.meta_oauth_app_id.strip() and self._settings.meta_oauth_app_secret.strip())

    def authorization_url(self, workspace_id: str | None = None, user_id: str | None = None) -> str:
        self._ensure_configured()
        redirect_uri = self.redirect_uri()
        state_id = uuid4().hex
        state = self._sign_state(
            {
                "provider": META_PROVIDER,
                "iat": int(time.time()),
                "jti": state_id,
                "redirect_uri": redirect_uri,
                "workspace_id": workspace_id,
                "user_id": user_id,
            }
        )
        self._store.save_oauth_state(
            META_PROVIDER,
            state_id,
            self._settings.meta_oauth_state_ttl_seconds,
            workspace_id=workspace_id,
            user_id=user_id,
        )
        query = urlencode(
            {
                "client_id": self._settings.meta_oauth_app_id.strip(),
                "redirect_uri": redirect_uri,
                "state": state,
                "scope": self._settings.meta_oauth_scopes,
                "response_type": "code",
            }
        )
        return f"https://www.facebook.com/{self._api_version()}/dialog/oauth?{query}"

    def redirect_uri(self) -> str:
        return f"{self._settings.public_base_or_local_web_url}{self._settings.meta_oauth_redirect_path}"

    def handle_callback(self, query: dict[str, str]) -> dict[str, Any]:
        self._ensure_configured()
        state_payload = self._verify_state(str(query.get("state", "") or "").strip())
        if query.get("error"):
            raise MetaOAuthError(_redact_oauth_error(query.get("error_description") or query.get("error_reason") or query["error"]))
        code = str(query.get("code", "") or "").strip()
        if not code:
            raise MetaOAuthError("Meta OAuth callback is missing code.")
        redirect_uri = str(state_payload.get("redirect_uri") or self.redirect_uri())
        short_token = self._exchange_code_for_token(code, redirect_uri)
        token = self._exchange_long_lived_token(short_token) or short_token
        accounts = self._fetch_ad_accounts(token)
        if not accounts:
            raise MetaOAuthError("Meta OAuth succeeded, but no ad accounts were returned.")
        pending = self._store.save_oauth_pending(
            META_PROVIDER,
            accounts,
            credentials={
                "app_id": self._settings.meta_oauth_app_id.strip(),
                "app_secret": self._settings.meta_oauth_app_secret.strip(),
                "access_token": token,
                "api_version": self._api_version(),
            },
            ttl_seconds=self._settings.meta_oauth_state_ttl_seconds,
            source="meta_oauth",
            workspace_id=str(state_payload.get("workspace_id") or "") or None,
            user_id=str(state_payload.get("user_id") or "") or None,
        )
        return pending | {"status": "pending_account_selection", "account_count": len(pending["accounts"])}

    def pending_selection(self, pending_id: str, workspace_id: str | None = None) -> dict[str, Any]:
        return self._store.pending_selection(META_PROVIDER, pending_id, workspace_id=workspace_id)

    def select_accounts(
        self,
        pending_id: str,
        account_ids: list[str],
        workspace_id: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        return self._store.select_pending_accounts(
            META_PROVIDER,
            pending_id,
            account_ids,
            workspace_id=workspace_id,
            user_id=user_id,
        )

    def _api_version(self) -> str:
        version = self._settings.meta_oauth_api_version.strip() or "v20.0"
        return version if version.startswith("v") else f"v{version}"

    def _ensure_configured(self) -> None:
        if not self.configured():
            raise MetaOAuthError("Meta OAuth is not configured. Set AD_MCP_META_OAUTH_APP_ID and AD_MCP_META_OAUTH_APP_SECRET.")

    def _signing_secret(self) -> bytes:
        secret = self._settings.web_api_token.strip() or self._settings.meta_oauth_app_secret.strip()
        if not secret:
            raise MetaOAuthError("Meta OAuth state signing secret is not configured.")
        return secret.encode("utf-8")

    def _sign_state(self, payload: dict[str, Any]) -> str:
        body = _b64_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signature = hmac.new(self._signing_secret(), body.encode("ascii"), hashlib.sha256).digest()
        return f"{body}.{_b64_encode(signature)}"

    def _verify_state(self, state: str) -> dict[str, Any]:
        try:
            body, signature = state.split(".", 1)
        except ValueError as exc:
            raise MetaOAuthError("Invalid Meta OAuth state.") from exc
        expected = _b64_encode(hmac.new(self._signing_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise MetaOAuthError("Invalid Meta OAuth state signature.")
        try:
            payload = json.loads(_b64_decode(body).decode("utf-8"))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error) as exc:
            raise MetaOAuthError("Invalid Meta OAuth state payload.") from exc
        if payload.get("provider") != META_PROVIDER:
            raise MetaOAuthError("Invalid Meta OAuth state provider.")
        state_id = str(payload.get("jti", "") or "").strip()
        if not state_id:
            raise MetaOAuthError("Invalid Meta OAuth state id.")
        try:
            issued_at = int(payload.get("iat") or 0)
        except (TypeError, ValueError) as exc:
            raise MetaOAuthError("Invalid Meta OAuth state timestamp.") from exc
        if int(time.time()) - issued_at > self._settings.meta_oauth_state_ttl_seconds:
            raise MetaOAuthError("Meta OAuth state expired.")
        try:
            self._store.consume_oauth_state(META_PROVIDER, state_id, workspace_id=str(payload.get("workspace_id") or "") or None)
        except ValueError as exc:
            raise MetaOAuthError(str(exc)) from exc
        return payload

    def _exchange_code_for_token(self, code: str, redirect_uri: str) -> str:
        payload = self._graph_get(
            "/oauth/access_token",
            {
                "client_id": self._settings.meta_oauth_app_id.strip(),
                "client_secret": self._settings.meta_oauth_app_secret.strip(),
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        token = str(payload.get("access_token", "") or "").strip()
        if not token:
            raise MetaOAuthError("Meta OAuth token exchange did not return access_token.")
        return token

    def _exchange_long_lived_token(self, short_token: str) -> str | None:
        try:
            payload = self._graph_get(
                "/oauth/access_token",
                {
                    "grant_type": "fb_exchange_token",
                    "client_id": self._settings.meta_oauth_app_id.strip(),
                    "client_secret": self._settings.meta_oauth_app_secret.strip(),
                    "fb_exchange_token": short_token,
                },
            )
        except MetaOAuthError:
            return None
        token = str(payload.get("access_token", "") or "").strip()
        return token or None

    def _fetch_ad_accounts(self, access_token: str) -> list[dict[str, Any]]:
        accounts: list[dict[str, Any]] = []
        path_or_url = "/me/adaccounts"
        params: dict[str, Any] | None = {
            "fields": "id,account_id,name,account_status,currency,timezone_name",
            "limit": 500,
        }
        for _ in range(10):
            payload = self._graph_get(path_or_url, params, access_token=access_token)
            for item in payload.get("data", []) or []:
                if not isinstance(item, dict):
                    continue
                account_id = str(item.get("id") or item.get("account_id") or "").strip()
                if not account_id:
                    continue
                accounts.append(
                    {
                        "name": item.get("name") or account_id,
                        "account_id": account_id,
                        "status": "connected",
                        "meta_account_status": item.get("account_status"),
                        "currency": item.get("currency"),
                        "timezone_name": item.get("timezone_name"),
                    }
                )
            next_url = ((payload.get("paging") or {}).get("next") if isinstance(payload.get("paging"), dict) else None)
            if not next_url:
                break
            path_or_url = str(next_url)
            params = None
        return accounts

    def _graph_get(self, path_or_url: str, params: dict[str, Any] | None, access_token: str | None = None) -> dict[str, Any]:
        url = path_or_url if path_or_url.startswith("https://") else f"https://graph.facebook.com/{self._api_version()}{path_or_url}"
        client = self._http_client or httpx.Client(timeout=20.0)
        close_client = self._http_client is None
        headers = {"Authorization": f"Bearer {access_token}"} if access_token else None
        try:
            response = client.get(url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise MetaOAuthError(f"Meta Graph request failed: {_redact_oauth_error(str(exc))}") from exc
        finally:
            if close_client:
                client.close()
        if not isinstance(payload, dict):
            raise MetaOAuthError("Meta Graph returned a non-object payload.")
        if "error" in payload:
            error = payload.get("error") or {}
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise MetaOAuthError(f"Meta Graph error: {message}")
        return payload

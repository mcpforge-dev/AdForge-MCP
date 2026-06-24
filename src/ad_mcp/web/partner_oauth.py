from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from abc import ABC, abstractmethod
from typing import Any
from urllib.parse import urlencode
from uuid import uuid4

import httpx

from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.core.errors import OAuthError
from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.settings import Settings


class PartnerOAuthError(OAuthError):
    pass


def _redact_oauth_error(text: str) -> str:
    return redact_secret_text(text)


def _http_error_detail(exc: httpx.HTTPError) -> str:
    if not isinstance(exc, httpx.HTTPStatusError):
        return _redact_oauth_error(str(exc))
    response = exc.response
    parts: list[str] = [f"HTTP {response.status_code}"]
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            for key in ("status", "message"):
                value = str(error.get(key) or "").strip()
                if value:
                    parts.append(f"{key}={value}")
            details = error.get("details")
            if isinstance(details, list):
                reasons = []
                for detail in details:
                    if isinstance(detail, dict):
                        for item in detail.get("errors", []) or []:
                            if isinstance(item, dict) and item.get("errorCode"):
                                reasons.append(str(item["errorCode"]))
                if reasons:
                    parts.append(f"details={'; '.join(reasons[:3])}")
        elif error:
            parts.append(str(error))
    else:
        body = response.text.strip()
        if body:
            parts.append(body[:280])
    return _redact_oauth_error(" | ".join(parts))


def _b64_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _b64_decode(payload: str) -> bytes:
    padding = "=" * (-len(payload) % 4)
    return base64.urlsafe_b64decode(f"{payload}{padding}".encode("ascii"))


def _split_scopes(value: str) -> str:
    return " ".join(part.strip() for part in value.replace(",", " ").split() if part.strip())


class BasePartnerOAuthService(ABC):
    provider: str
    state_ttl_seconds: int

    def __init__(self, settings: Settings | None = None, http_client: httpx.Client | None = None) -> None:
        self._settings = settings or Settings()
        self._store = HostedConnectionStore(self._settings.connection_store_file)
        self._http_client = http_client

    @abstractmethod
    def configured(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def authorization_url(self, workspace_id: str | None = None, user_id: str | None = None) -> str:
        raise NotImplementedError

    @abstractmethod
    def redirect_uri(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def handle_callback(self, query: dict[str, str]) -> dict[str, Any]:
        raise NotImplementedError

    def pending_selection(self, pending_id: str, workspace_id: str | None = None) -> dict[str, Any]:
        return self._store.pending_selection(self.provider, pending_id, workspace_id=workspace_id)

    def select_accounts(
        self,
        pending_id: str,
        account_ids: list[str],
        workspace_id: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        return self._store.select_pending_accounts(
            self.provider,
            pending_id,
            account_ids,
            workspace_id=workspace_id,
            user_id=user_id,
        )

    def _ensure_configured(self, missing: str) -> None:
        if not self.configured():
            raise PartnerOAuthError(f"{self.provider} OAuth is not configured. Set {missing}.")

    def _signing_secret(self) -> bytes:
        provider_secret_fields = {
            "google_ads": "google_oauth_client_secret",
            "tiktok_ads": "tiktok_oauth_app_secret",
            "yandex_direct": "yandex_oauth_client_secret",
        }
        provider_secret = getattr(self._settings, provider_secret_fields.get(self.provider, ""), "")
        secret = self._settings.web_api_token.strip() or str(provider_secret).strip()
        if not secret:
            raise PartnerOAuthError("OAuth state signing secret is not configured.")
        return secret.encode("utf-8")

    def _sign_state(self, payload: dict[str, Any]) -> str:
        body = _b64_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signature = hmac.new(self._signing_secret(), body.encode("ascii"), hashlib.sha256).digest()
        return f"{body}.{_b64_encode(signature)}"

    def _new_state(self, redirect_uri: str, workspace_id: str | None = None, user_id: str | None = None) -> str:
        state_id = uuid4().hex
        self._store.save_oauth_state(
            self.provider,
            state_id,
            self.state_ttl_seconds,
            workspace_id=workspace_id,
            user_id=user_id,
        )
        return self._sign_state(
            {
                "provider": self.provider,
                "iat": int(time.time()),
                "jti": state_id,
                "redirect_uri": redirect_uri,
                "workspace_id": workspace_id,
                "user_id": user_id,
            }
        )

    def _verify_state(self, state: str) -> dict[str, Any]:
        try:
            body, signature = state.split(".", 1)
        except ValueError as exc:
            raise PartnerOAuthError("Invalid OAuth state.") from exc
        expected = _b64_encode(hmac.new(self._signing_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise PartnerOAuthError("Invalid OAuth state signature.")
        try:
            payload = json.loads(_b64_decode(body).decode("utf-8"))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error) as exc:
            raise PartnerOAuthError("Invalid OAuth state payload.") from exc
        if payload.get("provider") != self.provider:
            raise PartnerOAuthError("Invalid OAuth state provider.")
        state_id = str(payload.get("jti", "") or "").strip()
        if not state_id:
            raise PartnerOAuthError("Invalid OAuth state id.")
        try:
            issued_at = int(payload.get("iat") or 0)
        except (TypeError, ValueError) as exc:
            raise PartnerOAuthError("Invalid OAuth state timestamp.") from exc
        if int(time.time()) - issued_at > self.state_ttl_seconds:
            raise PartnerOAuthError("OAuth state expired.")
        try:
            self._store.consume_oauth_state(self.provider, state_id, workspace_id=str(payload.get("workspace_id") or "") or None)
        except ValueError as exc:
            raise PartnerOAuthError(str(exc)) from exc
        return payload

    def _client(self) -> tuple[httpx.Client, bool]:
        if self._http_client is not None:
            return self._http_client, False
        return httpx.Client(timeout=20.0), True

    def _get_json(self, url: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
        client, close_client = self._client()
        try:
            response = client.get(url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise PartnerOAuthError(f"{self.provider} OAuth GET failed: {_http_error_detail(exc)}") from exc
        finally:
            if close_client:
                client.close()
        if not isinstance(payload, dict):
            raise PartnerOAuthError(f"{self.provider} returned a non-object payload.")
        return payload

    def _post_json(
        self,
        url: str,
        *,
        data: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        client, close_client = self._client()
        try:
            response = client.post(url, data=data, json=json_body, headers=headers)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise PartnerOAuthError(f"{self.provider} OAuth POST failed: {_http_error_detail(exc)}") from exc
        finally:
            if close_client:
                client.close()
        if not isinstance(payload, (dict, list)):
            raise PartnerOAuthError(f"{self.provider} returned a non-object payload.")
        return payload


class GoogleOAuthService(BasePartnerOAuthService):
    provider = "google_ads"

    @property
    def state_ttl_seconds(self) -> int:
        return self._settings.google_oauth_state_ttl_seconds

    def configured(self) -> bool:
        return bool(
            self._settings.google_oauth_client_id.strip()
            and self._settings.google_oauth_client_secret.strip()
            and self._settings.google_ads_developer_token.strip()
        )

    def redirect_uri(self) -> str:
        return f"{self._settings.public_base_or_local_web_url}{self._settings.google_oauth_redirect_path}"

    def authorization_url(self, workspace_id: str | None = None, user_id: str | None = None) -> str:
        self._ensure_configured(
            "AD_MCP_GOOGLE_OAUTH_CLIENT_ID, AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET and AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN"
        )
        redirect_uri = self.redirect_uri()
        state = self._new_state(redirect_uri, workspace_id=workspace_id, user_id=user_id)
        query = urlencode(
            {
                "client_id": self._settings.google_oauth_client_id.strip(),
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": _split_scopes(self._settings.google_oauth_scopes),
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
                "state": state,
            }
        )
        return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"

    def handle_callback(self, query: dict[str, str]) -> dict[str, Any]:
        self._ensure_configured(
            "AD_MCP_GOOGLE_OAUTH_CLIENT_ID, AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET and AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN"
        )
        state_payload = self._verify_state(str(query.get("state", "") or "").strip())
        if query.get("error"):
            raise PartnerOAuthError(_redact_oauth_error(query.get("error_description") or query["error"]))
        code = str(query.get("code", "") or "").strip()
        if not code:
            raise PartnerOAuthError("Google OAuth callback is missing code.")
        redirect_uri = str(state_payload.get("redirect_uri") or self.redirect_uri())
        token_payload = self._exchange_code_for_token(code, redirect_uri)
        access_token = str(token_payload.get("access_token", "") or "").strip()
        refresh_token = str(token_payload.get("refresh_token", "") or "").strip()
        if not access_token:
            raise PartnerOAuthError("Google OAuth token exchange did not return access_token.")
        if not refresh_token:
            raise PartnerOAuthError("Google OAuth token exchange did not return refresh_token. Reconnect with consent prompt.")
        accounts = self._fetch_accessible_customers(access_token)
        if not accounts:
            raise PartnerOAuthError("Google OAuth succeeded, but no accessible Google Ads accounts were returned.")
        pending = self._store.save_oauth_pending(
            self.provider,
            accounts,
            credentials={
                "developer_token": self._settings.google_ads_developer_token.strip(),
                "oauth_client_id": self._settings.google_oauth_client_id.strip(),
                "oauth_client_secret": self._settings.google_oauth_client_secret.strip(),
                "refresh_token": refresh_token,
                "access_token": access_token,
                "login_customer_id": self._settings.google_ads_login_customer_id.strip(),
            },
            ttl_seconds=self.state_ttl_seconds,
            source="google_oauth",
            workspace_id=str(state_payload.get("workspace_id") or "") or None,
            user_id=str(state_payload.get("user_id") or "") or None,
        )
        return pending | {"status": "pending_account_selection", "account_count": len(pending["accounts"])}

    def _exchange_code_for_token(self, code: str, redirect_uri: str) -> dict[str, Any]:
        return self._post_json(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": self._settings.google_oauth_client_id.strip(),
                "client_secret": self._settings.google_oauth_client_secret.strip(),
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    def _fetch_accessible_customers(self, access_token: str) -> list[dict[str, Any]]:
        version = (self._settings.google_ads_api_version.strip() or "v20").lstrip("/")
        try:
            payload = self._get_json(
                f"https://googleads.googleapis.com/{version}/customers:listAccessibleCustomers",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "developer-token": self._settings.google_ads_developer_token.strip(),
                },
            )
        except PartnerOAuthError as exc:
            raise PartnerOAuthError(
                "Google OAuth прошёл, но Google Ads API отклонил запрос списка аккаунтов. "
                "Проверьте в Google Ads API Center, что developer token активен и имеет доступ "
                "к production-аккаунтам (Explorer, Basic или Standard Access), а не только Test Account Access. "
                f"Техническая причина: {exc}"
            ) from exc
        accounts_by_id: dict[str, dict[str, Any]] = {}
        for resource_name in payload.get("resourceNames", []) or []:
            customer_id = str(resource_name).split("/")[-1].strip()
            if customer_id:
                accounts_by_id[customer_id] = {
                    "name": f"Google Ads {customer_id}",
                    "account_id": customer_id,
                    "customer_id": customer_id,
                    "manager_customer_id": "",
                    "login_customer_id": self._settings.google_ads_login_customer_id.strip(),
                    "google_ads_account_type": "accessible_customer",
                    "status": "connected",
                }
                for client_account in self._fetch_customer_clients(access_token, customer_id):
                    accounts_by_id.setdefault(client_account["customer_id"], client_account)
        return list(accounts_by_id.values())

    def _fetch_customer_clients(self, access_token: str, manager_customer_id: str) -> list[dict[str, Any]]:
        version = (self._settings.google_ads_api_version.strip() or "v20").lstrip("/")
        headers = {
            "Authorization": f"Bearer {access_token}",
            "developer-token": self._settings.google_ads_developer_token.strip(),
            "login-customer-id": self._settings.google_ads_login_customer_id.strip() or manager_customer_id,
        }
        query = """
            SELECT
              customer_client.client_customer,
              customer_client.descriptive_name,
              customer_client.id,
              customer_client.manager,
              customer_client.level,
              customer_client.status,
              customer_client.currency_code,
              customer_client.time_zone
            FROM customer_client
            WHERE customer_client.level <= 1
        """
        try:
            payload = self._post_json(
                f"https://googleads.googleapis.com/{version}/customers/{manager_customer_id}/googleAds:searchStream",
                json_body={"query": " ".join(query.split())},
                headers=headers,
            )
        except PartnerOAuthError:
            return []
        chunks = payload if isinstance(payload, list) else [payload]
        accounts: list[dict[str, Any]] = []
        for chunk in chunks:
            if not isinstance(chunk, dict):
                continue
            for row in chunk.get("results", []) or []:
                client = row.get("customerClient") if isinstance(row, dict) else None
                if not isinstance(client, dict):
                    continue
                customer_id = str(client.get("id") or "").strip()
                if not customer_id:
                    client_customer = str(client.get("clientCustomer") or "")
                    customer_id = client_customer.split("/")[-1].strip()
                if not customer_id:
                    continue
                accounts.append(
                    {
                        "name": client.get("descriptiveName") or f"Google Ads {customer_id}",
                        "account_id": customer_id,
                        "customer_id": customer_id,
                        "manager_customer_id": manager_customer_id,
                        "login_customer_id": headers["login-customer-id"],
                        "google_ads_account_type": "manager" if client.get("manager") else "customer",
                        "google_ads_level": client.get("level"),
                        "google_ads_status": client.get("status"),
                        "currency": client.get("currencyCode"),
                        "timezone_name": client.get("timeZone"),
                        "status": "connected",
                    }
                )
        return accounts


class TikTokOAuthService(BasePartnerOAuthService):
    provider = "tiktok_ads"

    @property
    def state_ttl_seconds(self) -> int:
        return self._settings.tiktok_oauth_state_ttl_seconds

    def configured(self) -> bool:
        return bool(self._settings.tiktok_oauth_app_id.strip() and self._settings.tiktok_oauth_app_secret.strip())

    def redirect_uri(self) -> str:
        return f"{self._settings.public_base_or_local_web_url}{self._settings.tiktok_oauth_redirect_path}"

    def authorization_url(self, workspace_id: str | None = None, user_id: str | None = None) -> str:
        self._ensure_configured("AD_MCP_TIKTOK_OAUTH_APP_ID and AD_MCP_TIKTOK_OAUTH_APP_SECRET")
        redirect_uri = self.redirect_uri()
        state = self._new_state(redirect_uri, workspace_id=workspace_id, user_id=user_id)
        params: dict[str, str] = {
            "app_id": self._settings.tiktok_oauth_app_id.strip(),
            "redirect_uri": redirect_uri,
            "state": state,
        }
        scopes = _split_scopes(self._settings.tiktok_oauth_scopes)
        if scopes:
            params["scope"] = scopes
        return f"{self._settings.tiktok_oauth_auth_url.strip()}?{urlencode(params)}"

    def handle_callback(self, query: dict[str, str]) -> dict[str, Any]:
        self._ensure_configured("AD_MCP_TIKTOK_OAUTH_APP_ID and AD_MCP_TIKTOK_OAUTH_APP_SECRET")
        state_payload = self._verify_state(str(query.get("state", "") or "").strip())
        if query.get("error"):
            raise PartnerOAuthError(_redact_oauth_error(query.get("error_description") or query["error"]))
        auth_code = str(query.get("auth_code") or query.get("code") or "").strip()
        if not auth_code:
            raise PartnerOAuthError("TikTok OAuth callback is missing auth_code.")
        token_payload = self._exchange_code_for_token(auth_code)
        token_data = token_payload.get("data") if isinstance(token_payload.get("data"), dict) else token_payload
        access_token = str(token_data.get("access_token", "") or "").strip()
        refresh_token = str(token_data.get("refresh_token", "") or "").strip()
        if not access_token:
            raise PartnerOAuthError("TikTok OAuth token exchange did not return access_token.")
        advertisers = self._advertisers_from_payload(token_data)
        if not advertisers:
            advertisers = self._fetch_advertisers(access_token)
        advertiser_ids = [item["advertiser_id"] for item in advertisers]
        if not advertiser_ids and self._settings.tiktok_oauth_advertiser_id.strip():
            fallback_id = self._settings.tiktok_oauth_advertiser_id.strip()
            advertisers = [{"advertiser_id": fallback_id, "name": f"TikTok Advertiser {fallback_id}"}]
            advertiser_ids = [fallback_id]
        if not advertiser_ids:
            raise PartnerOAuthError("TikTok OAuth succeeded, but no advertiser IDs were returned.")
        accounts = [
            {
                "name": advertiser.get("name") or f"TikTok Advertiser {advertiser['advertiser_id']}",
                "account_id": advertiser["advertiser_id"],
                "advertiser_id": advertiser["advertiser_id"],
                "app_id": self._settings.tiktok_oauth_app_id.strip(),
                "status": "connected",
            }
            for advertiser in advertisers
        ]
        pending = self._store.save_oauth_pending(
            self.provider,
            accounts,
            credentials={
                "app_id": self._settings.tiktok_oauth_app_id.strip(),
                "app_secret": self._settings.tiktok_oauth_app_secret.strip(),
                "access_token": access_token,
                "refresh_token": refresh_token,
            },
            ttl_seconds=self.state_ttl_seconds,
            source="tiktok_oauth",
            workspace_id=str(state_payload.get("workspace_id") or "") or None,
            user_id=str(state_payload.get("user_id") or "") or None,
        )
        return pending | {"status": "pending_account_selection", "account_count": len(pending["accounts"])}

    def _exchange_code_for_token(self, auth_code: str) -> dict[str, Any]:
        return self._post_json(
            self._settings.tiktok_oauth_token_url.strip(),
            json_body={
                "app_id": self._settings.tiktok_oauth_app_id.strip(),
                "secret": self._settings.tiktok_oauth_app_secret.strip(),
                "auth_code": auth_code,
            },
        )

    def _fetch_advertisers(self, access_token: str) -> list[dict[str, str]]:
        try:
            payload = self._get_json(
                self._settings.tiktok_oauth_advertiser_get_url.strip(),
                headers={"Access-Token": access_token},
            )
        except PartnerOAuthError:
            return []
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        return self._advertisers_from_payload(data)

    def _advertisers_from_payload(self, payload: dict[str, Any]) -> list[dict[str, str]]:
        candidates = (
            payload.get("advertiser_ids")
            or payload.get("advertiser_id_list")
            or payload.get("advertiser_info")
            or payload.get("list")
            or payload.get("advertiser_id")
            or []
        )
        if isinstance(candidates, str):
            return [{"advertiser_id": candidates, "name": f"TikTok Advertiser {candidates}"}]
        if isinstance(candidates, list):
            advertisers: list[dict[str, str]] = []
            for item in candidates:
                if isinstance(item, dict):
                    candidate = item.get("advertiser_id") or item.get("advertiserId") or item.get("id")
                    name = item.get("advertiser_name") or item.get("advertiserName") or item.get("name")
                else:
                    candidate = item
                    name = None
                value = str(candidate or "").strip()
                if value:
                    advertisers.append({"advertiser_id": value, "name": str(name or f"TikTok Advertiser {value}")})
            return advertisers
        return []


class YandexOAuthService(BasePartnerOAuthService):
    provider = "yandex_direct"

    @property
    def state_ttl_seconds(self) -> int:
        return self._settings.yandex_oauth_state_ttl_seconds

    def configured(self) -> bool:
        return bool(self._settings.yandex_oauth_client_id.strip() and self._settings.yandex_oauth_client_secret.strip())

    def redirect_uri(self) -> str:
        return f"{self._settings.public_base_or_local_web_url}{self._settings.yandex_oauth_redirect_path}"

    def authorization_url(self, workspace_id: str | None = None, user_id: str | None = None) -> str:
        self._ensure_configured("AD_MCP_YANDEX_OAUTH_CLIENT_ID and AD_MCP_YANDEX_OAUTH_CLIENT_SECRET")
        redirect_uri = self.redirect_uri()
        state = self._new_state(redirect_uri, workspace_id=workspace_id, user_id=user_id)
        query = urlencode(
            {
                "response_type": "code",
                "client_id": self._settings.yandex_oauth_client_id.strip(),
                "redirect_uri": redirect_uri,
                "scope": self._settings.yandex_oauth_scope.strip(),
                "state": state,
            }
        )
        return f"{self._settings.yandex_oauth_authorize_url.strip()}?{query}"

    def handle_callback(self, query: dict[str, str]) -> dict[str, Any]:
        self._ensure_configured("AD_MCP_YANDEX_OAUTH_CLIENT_ID and AD_MCP_YANDEX_OAUTH_CLIENT_SECRET")
        state_payload = self._verify_state(str(query.get("state", "") or "").strip())
        if query.get("error"):
            raise PartnerOAuthError(_redact_oauth_error(query.get("error_description") or query["error"]))
        code = str(query.get("code", "") or "").strip()
        if not code:
            raise PartnerOAuthError("Yandex OAuth callback is missing code.")
        redirect_uri = str(state_payload.get("redirect_uri") or self.redirect_uri())
        token_payload = self._exchange_code_for_token(code, redirect_uri)
        access_token = str(token_payload.get("access_token", "") or "").strip()
        refresh_token = str(token_payload.get("refresh_token", "") or "").strip()
        if not access_token:
            raise PartnerOAuthError("Yandex OAuth token exchange did not return access_token.")
        accounts = self._fetch_direct_clients(access_token)
        if not accounts:
            account_id = self._settings.yandex_direct_client_login.strip() or self._settings.yandex_direct_login.strip()
            if not account_id:
                raise PartnerOAuthError("Yandex Direct clients were not returned and AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN is not configured.")
            accounts = [
                {
                    "name": f"Yandex Direct {account_id}",
                    "account_id": account_id,
                    "login": self._settings.yandex_direct_login.strip(),
                    "direct_client_login": self._settings.yandex_direct_client_login.strip() or account_id,
                    "scope": self._settings.yandex_oauth_scope.strip(),
                    "status": "connected",
                }
            ]
        pending = self._store.save_oauth_pending(
            self.provider,
            accounts,
            credentials={
                "oauth_client_id": self._settings.yandex_oauth_client_id.strip(),
                "oauth_client_secret": self._settings.yandex_oauth_client_secret.strip(),
                "access_token": access_token,
                "refresh_token": refresh_token,
            },
            ttl_seconds=self.state_ttl_seconds,
            source="yandex_oauth",
            workspace_id=str(state_payload.get("workspace_id") or "") or None,
            user_id=str(state_payload.get("user_id") or "") or None,
        )
        return pending | {"status": "pending_account_selection", "account_count": len(pending["accounts"])}

    def _fetch_direct_clients(self, access_token: str) -> list[dict[str, Any]]:
        try:
            payload = self._post_json(
                self._settings.yandex_direct_clients_url.strip(),
                json_body={"method": "get", "params": {"FieldNames": ["Login", "ClientInfo", "Currency", "Archived"]}},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept-Language": "en",
                    "Content-Type": "application/json; charset=utf-8",
                },
            )
        except PartnerOAuthError:
            return []
        if not isinstance(payload, dict):
            return []
        result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
        clients = result.get("Clients") if isinstance(result, dict) else []
        accounts: list[dict[str, Any]] = []
        for client in clients or []:
            if not isinstance(client, dict):
                continue
            login = str(client.get("Login") or "").strip()
            if not login:
                continue
            accounts.append(
                {
                    "name": client.get("ClientInfo") or f"Yandex Direct {login}",
                    "account_id": login,
                    "login": self._settings.yandex_direct_login.strip(),
                    "direct_client_login": login,
                    "scope": self._settings.yandex_oauth_scope.strip(),
                    "currency": client.get("Currency"),
                    "yandex_archived": client.get("Archived"),
                    "status": "connected",
                }
            )
        return accounts

    def _exchange_code_for_token(self, code: str, redirect_uri: str) -> dict[str, Any]:
        return self._post_json(
            self._settings.yandex_oauth_token_url.strip(),
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": self._settings.yandex_oauth_client_id.strip(),
                "client_secret": self._settings.yandex_oauth_client_secret.strip(),
                "redirect_uri": redirect_uri,
            },
        )

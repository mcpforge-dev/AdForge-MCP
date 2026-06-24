from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from ad_mcp.settings import Settings


class GoogleLoginError(RuntimeError):
    """Raised when Google account login cannot be completed safely."""


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _safe_next_path(value: str) -> str:
    clean = (value or "/app").strip()
    if not clean.startswith("/") or clean.startswith("//"):
        return "/app"
    if clean.startswith(("/oauth/", "/auth/google/")):
        return "/app"
    return clean[:180]


class GoogleLoginService:
    def __init__(self, settings: Settings | None = None, http_client: httpx.Client | None = None) -> None:
        self._settings = settings or Settings()
        self._http_client = http_client

    def configured(self) -> bool:
        return bool(self._settings.google_login_client_id.strip() and self._settings.google_login_client_secret.strip())

    def authorization_url(self, *, next_path: str = "/app") -> str:
        if not self.configured():
            raise GoogleLoginError("Google Login пока не настроен. Добавьте Google Login Client ID и Secret на сервере.")
        params = {
            "client_id": self._settings.google_login_client_id.strip(),
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": self._settings.google_login_scopes.strip() or "openid email profile",
            "state": self._sign_state({"next": _safe_next_path(next_path), "nonce": secrets.token_urlsafe(16)}),
            "access_type": "online",
            "prompt": "select_account",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    def handle_callback(self, query: dict[str, Any]) -> dict[str, str]:
        if query.get("error"):
            raise GoogleLoginError("Google отменил вход или вернул ошибку авторизации.")
        code = str(query.get("code") or "").strip()
        if not code:
            raise GoogleLoginError("Google не вернул код авторизации.")
        self._verify_state(str(query.get("state") or ""))
        token_payload = self._exchange_code(code)
        access_token = str(token_payload.get("access_token") or "").strip()
        if not access_token:
            raise GoogleLoginError("Google не вернул access token для входа.")
        profile = self._fetch_userinfo(access_token)
        email = str(profile.get("email") or "").strip().lower()
        if "@" not in email:
            raise GoogleLoginError("Google не вернул email аккаунта.")
        if profile.get("email_verified") is False:
            raise GoogleLoginError("Email в Google аккаунте не подтверждён.")
        return {
            "email": email,
            "name": str(profile.get("name") or profile.get("given_name") or email).strip() or email,
            "picture": str(profile.get("picture") or ""),
        }

    @property
    def redirect_uri(self) -> str:
        base = self._settings.public_base_or_local_web_url.rstrip("/")
        return f"{base}{self._settings.google_login_redirect_path}"

    def _sign_state(self, payload: dict[str, Any]) -> str:
        payload = payload | {"iat": int(time.time())}
        body = _b64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        digest = hmac.new(self._state_secret, body.encode("ascii"), hashlib.sha256).digest()
        return f"{body}.{_b64url_encode(digest)}"

    def _verify_state(self, state: str) -> dict[str, Any]:
        try:
            body, signature = state.split(".", 1)
            expected = _b64url_encode(hmac.new(self._state_secret, body.encode("ascii"), hashlib.sha256).digest())
            if not hmac.compare_digest(signature, expected):
                raise ValueError("bad signature")
            payload = json.loads(_b64url_decode(body).decode("utf-8"))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise GoogleLoginError("Сессия Google Login недействительна. Попробуйте войти ещё раз.") from exc
        age = int(time.time()) - int(payload.get("iat") or 0)
        if age < 0 or age > max(60, int(self._settings.google_login_state_ttl_seconds)):
            raise GoogleLoginError("Сессия Google Login истекла. Попробуйте войти ещё раз.")
        return payload

    @property
    def _state_secret(self) -> bytes:
        secret = self._settings.google_login_client_secret.strip() or self._settings.web_api_token.strip()
        if not secret:
            secret = "adforge-google-login-dev-secret"
        return secret.encode("utf-8")

    def _client(self) -> tuple[httpx.Client, bool]:
        if self._http_client:
            return self._http_client, False
        return httpx.Client(timeout=15.0), True

    def _exchange_code(self, code: str) -> dict[str, Any]:
        client, close = self._client()
        try:
            response = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": self._settings.google_login_client_id.strip(),
                    "client_secret": self._settings.google_login_client_secret.strip(),
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": self.redirect_uri,
                },
            )
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, dict) else {}
        except (httpx.HTTPError, ValueError) as exc:
            raise GoogleLoginError("Не удалось обменять Google authorization code.") from exc
        finally:
            if close:
                client.close()

    def _fetch_userinfo(self, access_token: str) -> dict[str, Any]:
        client, close = self._client()
        try:
            response = client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, dict) else {}
        except (httpx.HTTPError, ValueError) as exc:
            raise GoogleLoginError("Не удалось получить профиль Google аккаунта.") from exc
        finally:
            if close:
                client.close()

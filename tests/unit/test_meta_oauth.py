from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from ad_mcp.settings import Settings
from ad_mcp.web.meta_oauth import MetaOAuthError, MetaOAuthService


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeMetaHTTP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict | None]] = []

    def get(self, url: str, params: dict | None = None, headers: dict | None = None) -> _FakeResponse:
        self.calls.append((url, params))
        if url.endswith("/oauth/access_token") and params and params.get("code") == "callback-code":
            return _FakeResponse({"access_token": "short-token"})
        if url.endswith("/oauth/access_token") and params and params.get("grant_type") == "fb_exchange_token":
            return _FakeResponse({"access_token": "long-token"})
        if url.endswith("/me/adaccounts"):
            assert headers == {"Authorization": "Bearer long-token"}
            assert params and "access_token" not in params
            return _FakeResponse(
                {
                    "data": [
                        {
                            "id": "act_111",
                            "account_id": "111",
                            "name": "Client Meta 1",
                            "account_status": 1,
                            "currency": "USD",
                            "timezone_name": "UTC",
                            "business": {"id": "biz_1", "name": "Business One"},
                        },
                        {
                            "id": "act_222",
                            "account_id": "222",
                            "name": "Client Meta 2",
                        },
                    ]
                }
            )
        if url.endswith("/me/permissions"):
            assert headers == {"Authorization": "Bearer long-token"}
            return _FakeResponse(
                {
                    "data": [
                        {"permission": "ads_read", "status": "granted"},
                        {"permission": "business_management", "status": "granted"},
                        {"permission": "pages_show_list", "status": "granted"},
                        {"permission": "pages_read_engagement", "status": "granted"},
                    ]
                }
            )
        if url.endswith("/me/businesses"):
            assert headers == {"Authorization": "Bearer long-token"}
            return _FakeResponse({"data": [{"id": "biz_1", "name": "Business One"}]})
        if url.endswith("/me/accounts"):
            assert headers == {"Authorization": "Bearer long-token"}
            return _FakeResponse(
                {
                    "data": [
                        {
                            "id": "page_1",
                            "name": "Page One",
                            "access_token": "page-token",
                        }
                    ]
                }
            )
        raise AssertionError(f"Unexpected Meta call: {url} {params}")


def _settings(tmp_path, **overrides):
    values = {
        "project_root": tmp_path,
        "public_base_url": "https://mcp.adforge.dev",
        "web_api_token": "state-secret",
        "meta_oauth_app_id": "meta-app-id",
        "meta_oauth_app_secret": "meta-app-secret",
        "connection_store_path": "tokens/connections.json",
    }
    values.update(overrides)
    return Settings(**values)


def test_meta_oauth_authorization_url_contains_signed_state(tmp_path) -> None:
    service = MetaOAuthService(_settings(tmp_path), _FakeMetaHTTP())

    url = service.authorization_url()
    query = parse_qs(urlparse(url).query)

    assert url.startswith("https://www.facebook.com/v20.0/dialog/oauth?")
    assert query["client_id"] == ["meta-app-id"]
    assert query["redirect_uri"] == ["https://mcp.adforge.dev/oauth/meta/callback"]
    assert query["scope"] == ["ads_read,business_management,pages_show_list,pages_read_engagement"]
    assert "read_insights" not in query["scope"][0]
    assert "instagram_basic" not in query["scope"][0]
    assert "ads_management" not in query["scope"][0]
    assert query["state"][0].count(".") == 1


def test_meta_oauth_ads_management_is_added_only_by_explicit_feature_flag(tmp_path) -> None:
    service = MetaOAuthService(
        _settings(tmp_path, meta_ads_management_oauth_enabled=True),
        _FakeMetaHTTP(),
    )

    query = parse_qs(urlparse(service.authorization_url()).query)

    assert query["scope"] == [
        "ads_read,business_management,pages_show_list,pages_read_engagement,ads_management"
    ]


def test_manual_meta_oauth_stays_read_only_when_ads_management_is_enabled(tmp_path) -> None:
    service = MetaOAuthService(
        _settings(tmp_path, meta_ads_management_oauth_enabled=True),
        _FakeMetaHTTP(),
    )

    url = service.authorization_url(manual_request_id="request-1", include_ads_management=False)
    query = parse_qs(urlparse(url).query)

    assert query["scope"] == ["ads_read,business_management,pages_show_list,pages_read_engagement"]


def test_meta_oauth_callback_discovers_accounts_and_select_saves_credentials(tmp_path) -> None:
    http = _FakeMetaHTTP()
    service = MetaOAuthService(_settings(tmp_path), http)
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]

    pending = service.handle_callback({"code": "callback-code", "state": state})
    selected = service.select_accounts(pending["pending_id"], ["act_111"])
    stored_config = service._store.provider_config("meta_ads")

    assert pending["status"] == "pending_account_selection"
    assert pending["account_count"] == 2
    assert pending["accounts"][0]["account_id"] == "act_111"
    assert "long-token" not in str(pending)
    assert selected["status"] == "connected"
    assert len(selected["accounts"]) == 1
    assert selected["accounts"][0] | {
        "name": "Client Meta 1",
        "account_id": "act_111",
        "app_id": "meta-app-id",
        "currency": "USD",
        "timezone_name": "UTC",
        "status": "connected",
        "credentials_present": True,
    } == selected["accounts"][0]
    assert stored_config["accounts"][0]["access_token"] == "long-token"
    assert stored_config["accounts"][0]["app_secret"] == "meta-app-secret"
    assert stored_config["accounts"][0]["business_id"] == "biz_1"
    assert stored_config["accounts"][0]["page_id"] == "page_1"
    assert stored_config["accounts"][0]["page_access_tokens"] == {"page_1": "page-token"}
    assert "page-token" not in str(selected)


def test_meta_oauth_manual_request_is_signed_and_returned_as_safe_metadata(tmp_path) -> None:
    service = MetaOAuthService(_settings(tmp_path), _FakeMetaHTTP())
    url = service.authorization_url(
        workspace_id="workspace-client",
        user_id="user-client",
        manual_request_id="request-123",
    )
    state = parse_qs(urlparse(url).query)["state"][0]

    pending = service.handle_callback({"code": "callback-code", "state": state})

    assert pending["metadata"]["manual_request_id"] == "request-123"
    assert "long-token" not in str(pending)


def test_meta_oauth_rejects_tampered_state(tmp_path) -> None:
    service = MetaOAuthService(_settings(tmp_path), _FakeMetaHTTP())
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]

    with pytest.raises(MetaOAuthError, match="signature"):
        service.handle_callback({"code": "callback-code", "state": f"{state}tampered"})


def test_meta_oauth_state_is_single_use(tmp_path) -> None:
    service = MetaOAuthService(_settings(tmp_path), _FakeMetaHTTP())
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]

    service.handle_callback({"code": "callback-code", "state": state})

    with pytest.raises(MetaOAuthError, match="already used|not found"):
        service.handle_callback({"code": "callback-code", "state": state})


def test_meta_oauth_rejects_expired_state(tmp_path, monkeypatch) -> None:
    from ad_mcp.web import meta_oauth

    settings = _settings(tmp_path)
    service = MetaOAuthService(settings, _FakeMetaHTTP())
    issued_at = 1_700_000_000
    monkeypatch.setattr(meta_oauth.time, "time", lambda: issued_at)
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]
    monkeypatch.setattr(meta_oauth.time, "time", lambda: issued_at + settings.meta_oauth_state_ttl_seconds + 1)

    with pytest.raises(MetaOAuthError, match="expired"):
        service.handle_callback({"code": "callback-code", "state": state})


def test_meta_oauth_requires_app_credentials(tmp_path) -> None:
    service = MetaOAuthService(Settings(project_root=tmp_path, public_base_url="https://mcp.adforge.dev"))

    with pytest.raises(MetaOAuthError, match="not configured"):
        service.authorization_url()

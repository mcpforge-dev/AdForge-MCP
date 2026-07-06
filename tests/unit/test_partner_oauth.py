from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from ad_mcp.settings import Settings
from ad_mcp.web.partner_oauth import (
    GoogleOAuthService,
    GoogleSearchConsoleOAuthService,
    PartnerOAuthError,
    TikTokOAuthService,
    YandexOAuthService,
)


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FailingGoogleAdsResponse:
    status_code = 400

    def __init__(self, url: str) -> None:
        self._url = url
        self.text = '{"error":{"status":"INVALID_ARGUMENT","message":"Developer token is not approved."}}'

    def raise_for_status(self) -> None:
        raise httpx.HTTPStatusError(
            "Client error '400 Bad Request'",
            request=httpx.Request("GET", self._url),
            response=httpx.Response(
                self.status_code,
                request=httpx.Request("GET", self._url),
                json={"error": {"status": "INVALID_ARGUMENT", "message": "Developer token is not approved."}},
            ),
        )

    def json(self) -> dict:
        return {"error": {"status": "INVALID_ARGUMENT", "message": "Developer token is not approved."}}


class _FakePartnerHTTP:
    def __init__(self, *, fail_google_accessible_customers: bool = False, yandex_clients: list[dict] | None = None) -> None:
        self.calls: list[tuple[str, str, dict | None, dict | None, dict | None]] = []
        self.fail_google_accessible_customers = fail_google_accessible_customers
        self.yandex_clients = yandex_clients

    def post(self, url: str, data: dict | None = None, json: dict | None = None, headers: dict | None = None) -> _FakeResponse:  # noqa: A002
        self.calls.append(("POST", url, data, json, headers))
        if url == "https://oauth2.googleapis.com/token":
            assert data and data["code"] == "google-code"
            return _FakeResponse({"access_token": "google-access", "refresh_token": "google-refresh"})
        if url.endswith("/googleAds:searchStream"):
            assert json and "customer_client" in json["query"]
            return _FakeResponse(
                [
                    {
                        "results": [
                            {
                                "customerClient": {
                                    "clientCustomer": "customers/5555555555",
                                    "descriptiveName": "Child Google Client",
                                    "id": "5555555555",
                                    "manager": False,
                                    "level": 1,
                                    "status": "ENABLED",
                                    "currencyCode": "USD",
                                    "timeZone": "UTC",
                                }
                            }
                        ]
                    }
                ]
            )
        if url == "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/":
            assert json and json["auth_code"] == "tiktok-code"
            return _FakeResponse({"data": {"access_token": "tiktok-access", "refresh_token": "tiktok-refresh"}})
        if url == "https://oauth.yandex.ru/token":
            assert data and data["code"] == "yandex-code"
            return _FakeResponse({"access_token": "yandex-access", "refresh_token": "yandex-refresh"})
        if url == "https://api.direct.yandex.com/json/v5/clients":
            assert headers and headers["Authorization"] == "Bearer yandex-access"
            return _FakeResponse(
                {
                    "result": {
                        "Clients": self.yandex_clients
                        if self.yandex_clients is not None
                        else [
                            {
                                "Login": "client-from-api",
                                "ClientInfo": "Yandex API Client",
                                "Currency": "KZT",
                                "Archived": "NO",
                            }
                        ]
                    }
                }
            )
        raise AssertionError(f"Unexpected POST: {url} {data} {json}")

    def get(self, url: str, params: dict | None = None, headers: dict | None = None) -> _FakeResponse:
        self.calls.append(("GET", url, params, None, headers))
        if url == "https://googleads.googleapis.com/v24/customers:listAccessibleCustomers":
            assert headers and headers["Authorization"] == "Bearer google-access"
            assert headers["developer-token"] == "google-dev-token"
            if self.fail_google_accessible_customers:
                return _FailingGoogleAdsResponse(url)  # type: ignore[return-value]
            return _FakeResponse({"resourceNames": ["customers/1234567890", "customers/9876543210"]})
        if url == "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/":
            assert headers and headers["Access-Token"] == "tiktok-access"
            return _FakeResponse({"data": {"list": [{"advertiser_id": "7444458786967928833", "advertiser_name": "TikTok API Advertiser"}]}})
        if url == "https://www.googleapis.com/webmasters/v3/sites":
            assert headers and headers["Authorization"] == "Bearer google-access"
            return _FakeResponse(
                {
                    "siteEntry": [
                        {"siteUrl": "https://holymedia.kz/", "permissionLevel": "siteOwner"},
                        {"siteUrl": "sc-domain:holymedia.kz", "permissionLevel": "siteFullUser"},
                    ]
                }
            )
        raise AssertionError(f"Unexpected GET: {url} {params}")


def _settings(tmp_path):
    return Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.adforge.dev",
        web_api_token="state-secret",
        google_oauth_client_id="google-client-id",
        google_oauth_client_secret="google-client-secret",
        google_ads_developer_token="google-dev-token",
        tiktok_oauth_app_id="tiktok-app-id",
        tiktok_oauth_app_secret="tiktok-app-secret",
        yandex_oauth_client_id="yandex-client-id",
        yandex_oauth_client_secret="yandex-client-secret",
        yandex_direct_login="agency-login",
        yandex_direct_client_login="client-login",
        connection_store_path="tokens/connections.json",
    )


def test_google_oauth_discovers_customers_and_select_saves_credentials(tmp_path) -> None:
    http = _FakePartnerHTTP()
    service = GoogleOAuthService(_settings(tmp_path), http)
    url = service.authorization_url()
    query = parse_qs(urlparse(url).query)

    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert query["client_id"] == ["google-client-id"]
    assert query["redirect_uri"] == ["https://mcp.adforge.dev/oauth/google/callback"]
    assert query["scope"] == ["https://www.googleapis.com/auth/adwords"]
    pending = service.handle_callback({"code": "google-code", "state": query["state"][0]})
    selected = service.select_accounts(pending["pending_id"], ["1234567890"])
    stored = service._store.provider_config("google_ads")  # noqa: SLF001

    assert pending["account_count"] == 3
    assert pending["accounts"][0]["customer_id"] == "1234567890"
    assert any(account["customer_id"] == "5555555555" for account in pending["accounts"])
    assert "google-refresh" not in str(pending)
    assert selected["status"] == "connected"
    assert selected["accounts"][0]["account_id"] == "1234567890"
    assert stored["accounts"][0]["refresh_token"] == "google-refresh"
    assert stored["accounts"][0]["developer_token"] == "google-dev-token"


def test_google_oauth_allows_manual_customer_id_when_discovery_fails(tmp_path) -> None:
    http = _FakePartnerHTTP(fail_google_accessible_customers=True)
    service = GoogleOAuthService(_settings(tmp_path), http)
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]

    pending = service.handle_callback({"code": "google-code", "state": state})
    selected = service.select_accounts(pending["pending_id"], ["123-456-7890"])
    stored = service._store.provider_config("google_ads")  # noqa: SLF001

    assert pending["status"] == "pending_account_selection"
    assert pending["account_count"] == 0
    assert pending["metadata"]["accessible_customers_status"] == "blocked"
    assert pending["metadata"]["manual_customer_entry_allowed"] is True
    assert "google-refresh" not in str(pending)
    assert selected["status"] == "connected"
    assert selected["accounts"][0]["customer_id"] == "1234567890"
    assert selected["accounts"][0]["google_ads_account_type"] == "manual_customer_id"
    assert stored["accounts"][0]["refresh_token"] == "google-refresh"
    assert stored["accounts"][0]["developer_token"] == "google-dev-token"


def test_google_search_console_oauth_discovers_sites_without_ads_developer_token(tmp_path) -> None:
    settings = _settings(tmp_path).model_copy(update={"google_ads_developer_token": ""})
    http = _FakePartnerHTTP()
    service = GoogleSearchConsoleOAuthService(settings, http)
    url = service.authorization_url()
    query = parse_qs(urlparse(url).query)

    assert query["redirect_uri"] == ["https://mcp.adforge.dev/oauth/google-search-console/callback"]
    assert query["scope"] == ["https://www.googleapis.com/auth/webmasters.readonly"]
    pending = service.handle_callback({"code": "google-code", "state": query["state"][0]})
    selected = service.select_accounts(pending["pending_id"], ["https://holymedia.kz/"])
    stored = service._store.provider_config("google_search_console")  # noqa: SLF001

    assert pending["account_count"] == 2
    assert pending["accounts"][0]["site_url"] == "https://holymedia.kz/"
    assert "google-refresh" not in str(pending)
    assert selected["status"] == "connected"
    assert selected["accounts"][0]["account_id"] == "https://holymedia.kz/"
    assert stored["accounts"][0]["refresh_token"] == "google-refresh"
    assert stored["accounts"][0]["site_url"] == "https://holymedia.kz/"


def test_tiktok_oauth_discovers_advertiser_and_select_saves_credentials(tmp_path) -> None:
    http = _FakePartnerHTTP()
    service = TikTokOAuthService(_settings(tmp_path), http)
    query = parse_qs(urlparse(service.authorization_url()).query)

    assert query["app_id"] == ["tiktok-app-id"]
    assert query["redirect_uri"] == ["https://mcp.adforge.dev/oauth/tiktok/callback"]
    pending = service.handle_callback({"auth_code": "tiktok-code", "state": query["state"][0]})
    selected = service.select_accounts(pending["pending_id"], ["7444458786967928833"])
    stored = service._store.provider_config("tiktok_ads")  # noqa: SLF001

    assert pending["account_count"] == 1
    assert pending["accounts"][0]["advertiser_id"] == "7444458786967928833"
    assert pending["accounts"][0]["name"] == "TikTok API Advertiser"
    assert "tiktok-access" not in str(selected)
    assert selected["accounts"][0]["app_id"] == "tiktok-app-id"
    assert stored["accounts"][0]["access_token"] == "tiktok-access"
    assert stored["accounts"][0]["app_secret"] == "tiktok-app-secret"


def test_yandex_oauth_uses_configured_direct_client_login(tmp_path) -> None:
    http = _FakePartnerHTTP()
    service = YandexOAuthService(_settings(tmp_path), http)
    query = parse_qs(urlparse(service.authorization_url()).query)

    assert query["client_id"] == ["yandex-client-id"]
    assert query["redirect_uri"] == ["https://mcp.adforge.dev/oauth/yandex/callback"]
    assert query["scope"] == ["direct:api"]
    pending = service.handle_callback({"code": "yandex-code", "state": query["state"][0]})
    selected = service.select_accounts(pending["pending_id"], ["client-from-api"])
    stored = service._store.provider_config("yandex_direct")  # noqa: SLF001

    assert pending["account_count"] == 1
    assert pending["metadata"]["api_clients_returned"] == 1
    assert pending["metadata"]["archived_clients"] == 0
    assert pending["metadata"]["fallback_used"] is False
    assert pending["accounts"][0]["direct_client_login"] == "client-from-api"
    assert "yandex-access" not in str(selected)
    assert selected["accounts"][0]["account_id"] == "client-from-api"
    assert selected["accounts"][0]["currency"] == "KZT"
    assert stored["accounts"][0]["access_token"] == "yandex-access"
    assert stored["accounts"][0]["oauth_client_secret"] == "yandex-client-secret"


def test_yandex_oauth_marks_archived_clients_as_disabled(tmp_path) -> None:
    http = _FakePartnerHTTP(
        yandex_clients=[
            {
                "Login": "active-client",
                "ClientInfo": "Active Client",
                "Currency": "KZT",
                "Archived": "NO",
            },
            {
                "Login": "archived-client",
                "ClientInfo": "Archived Client",
                "Currency": "KZT",
                "Archived": "YES",
            },
        ]
    )
    service = YandexOAuthService(_settings(tmp_path), http)
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]

    pending = service.handle_callback({"code": "yandex-code", "state": state})

    assert pending["account_count"] == 2
    assert pending["metadata"]["api_clients_returned"] == 2
    assert pending["metadata"]["active_clients"] == 1
    assert pending["metadata"]["archived_clients"] == 1
    archived = next(account for account in pending["accounts"] if account["account_id"] == "archived-client")
    assert archived["status"] == "archived"
    assert archived["selection_disabled"] == "True"
    assert archived["yandex_archived"] == "YES"

    selected = service.select_accounts(pending["pending_id"], ["active-client", "archived-client"])
    assert [account["account_id"] for account in selected["accounts"]] == ["active-client"]


def test_partner_oauth_rejects_tampered_state(tmp_path) -> None:
    service = GoogleOAuthService(_settings(tmp_path), _FakePartnerHTTP())
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]

    with pytest.raises(PartnerOAuthError, match="signature"):
        service.handle_callback({"code": "google-code", "state": f"{state}tampered"})


def test_partner_oauth_state_is_single_use(tmp_path) -> None:
    service = GoogleOAuthService(_settings(tmp_path), _FakePartnerHTTP())
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]

    service.handle_callback({"code": "google-code", "state": state})

    with pytest.raises(PartnerOAuthError, match="already used|not found"):
        service.handle_callback({"code": "google-code", "state": state})


def test_partner_oauth_rejects_expired_state(tmp_path, monkeypatch) -> None:
    import ad_mcp.web.partner_oauth as partner_oauth

    settings = _settings(tmp_path)
    service = GoogleOAuthService(settings, _FakePartnerHTTP())
    issued_at = 1_700_000_000
    monkeypatch.setattr(partner_oauth.time, "time", lambda: issued_at)
    state = parse_qs(urlparse(service.authorization_url()).query)["state"][0]
    monkeypatch.setattr(partner_oauth.time, "time", lambda: issued_at + settings.google_oauth_state_ttl_seconds + 1)

    with pytest.raises(PartnerOAuthError, match="expired"):
        service.handle_callback({"code": "google-code", "state": state})

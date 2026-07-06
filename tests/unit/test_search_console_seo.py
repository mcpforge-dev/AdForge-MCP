from __future__ import annotations

from pathlib import Path

from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.settings import Settings
from ad_mcp.web.seo import SearchConsoleReportService


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeSearchConsoleHTTP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict | None, dict | None]] = []

    def post(self, url: str, data: dict | None = None, json: dict | None = None, headers: dict | None = None) -> _FakeResponse:  # noqa: A002
        self.calls.append(("POST", url, data, json))
        if url == "https://oauth2.googleapis.com/token":
            assert data and data["refresh_token"] == "refresh-token"
            return _FakeResponse({"access_token": "fresh-access"})
        assert headers and headers["Authorization"] == "Bearer fresh-access"
        if json and json.get("dimensions") == []:
            return _FakeResponse({"rows": [{"clicks": 12, "impressions": 300, "ctr": 0.04, "position": 7.2}]})
        if json and json.get("dimensions") == ["query"]:
            return _FakeResponse(
                {
                    "rows": [
                        {"keys": ["mcp реклама"], "clicks": 5, "impressions": 120, "ctr": 0.041, "position": 8.5}
                    ]
                }
            )
        if json and json.get("dimensions") == ["page"]:
            return _FakeResponse(
                {
                    "rows": [
                        {"keys": ["https://holymedia.kz/"], "clicks": 7, "impressions": 180, "ctr": 0.038, "position": 6.1}
                    ]
                }
            )
        if json and json.get("dimensions") == ["date"]:
            return _FakeResponse(
                {"rows": [{"keys": ["2026-07-01"], "clicks": 2, "impressions": 40, "ctr": 0.05, "position": 5.5}]}
            )
        raise AssertionError(f"Unexpected POST: {url} {json}")

    def get(self, url: str, headers: dict | None = None) -> _FakeResponse:
        self.calls.append(("GET", url, None, None))
        assert headers and headers["Authorization"] == "Bearer fresh-access"
        return _FakeResponse({"sitemap": [{"path": "https://holymedia.kz/sitemap.xml", "errors": 0, "warnings": 1}]})


def _settings(tmp_path: Path) -> Settings:
    return Settings(project_root=tmp_path, connection_store_path="tokens/connections.json")


def test_search_console_report_uses_workspace_connection_and_hides_secrets(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    store = HostedConnectionStore(settings.connection_store_file)
    store.save_provider_config(
        "google_search_console",
        {
            "provider": "google_search_console",
            "accounts": [
                {
                    "name": "https://holymedia.kz/",
                    "account_id": "https://holymedia.kz/",
                    "site_url": "https://holymedia.kz/",
                    "permission_level": "siteOwner",
                    "oauth_client_id": "client-id",
                    "oauth_client_secret": "client-secret",
                    "refresh_token": "refresh-token",
                }
            ],
        },
        workspace_id="workspace-1",
    )
    user = type("User", (), {"workspace_id": "workspace-1"})()

    report = SearchConsoleReportService(settings, _FakeSearchConsoleHTTP()).report(user)

    assert report["status"] == "ok"
    assert report["metrics"]["clicks"] == 12
    assert report["top_queries"][0]["query"] == "mcp реклама"
    assert report["opportunities"][0]["query"] == "mcp реклама"
    assert report["sitemaps"]["count"] == 1
    assert "client-secret" not in str(report)
    assert "refresh-token" not in str(report)


def test_search_console_report_returns_not_connected_for_empty_workspace(tmp_path: Path) -> None:
    report = SearchConsoleReportService(_settings(tmp_path), _FakeSearchConsoleHTTP()).report(
        type("User", (), {"workspace_id": "workspace-1"})()
    )

    assert report["status"] == "not_connected"
    assert report["properties"] == []

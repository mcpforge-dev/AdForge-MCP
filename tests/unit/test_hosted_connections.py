from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.settings import Settings
from ad_mcp.web.hosted import HostedConnectionService


def test_mcp_connection_info_uses_public_url_and_route_path(tmp_path: Path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.adforge.dev/",
        mcp_endpoint_path="mcp",
        connections_config="missing.yaml",
    )
    service = HostedConnectionService(settings)

    info = service.mcp_connection_info()

    assert settings.mcp_route_path == "/mcp"
    assert info["url"] == "https://mcp.adforge.dev/mcp"
    assert info["transport"] == "streamable_http"
    assert info["auth"]["type"] == "bearer"


def test_mcp_connection_info_exposes_safe_ai_client_compatibility(tmp_path: Path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.adforge.dev/",
        mcp_endpoint_path="mcp",
        connections_config="missing.yaml",
    )
    service = HostedConnectionService(settings)

    info = service.mcp_connection_info()
    clients = info["clients"]
    text = str(info).lower()

    assert clients["codex"]["status"] == "ready"
    assert clients["claude"]["status"] == "oauth_ready"
    assert clients["chatgpt"]["status"] == "oauth_cimd_ready"
    assert clients["chatgpt"]["self_serve_ready"] is True
    assert info["chatgpt_oauth_required"] is False
    assert info["chatgpt_cimd_supported"] is True
    assert "personal_mcp_token" in text
    assert "beta_token" not in text
    assert "client_secret" not in text
    assert "refresh_token" not in text


def test_connections_response_does_not_expose_provider_secrets(tmp_path: Path) -> None:
    config = tmp_path / "ads_config.yaml"
    config.write_text(
        """
providers:
  meta_ads:
    provider: meta_ads
    accounts:
      - name: Client Meta
        account_id: "act_123"
        status: configured
        app_secret: super-secret
        access_token: token-value
  google_ads:
    provider: google_ads
    accounts:
      - name: Client Google
        customer_id: "123-456-7890"
        refresh_token: refresh-secret
""",
        encoding="utf-8",
    )
    settings = Settings(project_root=tmp_path, connections_config="ads_config.yaml")
    service = HostedConnectionService(settings)

    payload = service.connections()
    text = str(payload)

    assert "super-secret" not in text
    assert "token-value" not in text
    assert "refresh-secret" not in text
    assert payload["platforms"][0]["status"] == "development_configured"
    assert payload["platforms"][0]["accounts"][0]["credentials_present"] is True


def test_oauth_start_preview_marks_beta_platform_as_not_configured(tmp_path: Path) -> None:
    settings = Settings(project_root=tmp_path, public_base_url="https://mcp.adforge.dev")
    service = HostedConnectionService(settings)

    payload = service.oauth_start_preview("meta_ads")

    assert payload["status"] == "oauth_not_configured"
    assert payload["redirect_url"] == "https://mcp.adforge.dev/oauth/meta/callback"


def test_dashboard_oauth_return_url_points_to_connections(tmp_path: Path) -> None:
    settings = Settings(project_root=tmp_path, public_base_url="https://mcp.adforge.dev")
    service = HostedConnectionService(settings)

    success = service.dashboard_oauth_return_url("google_ads", {"status": "pending_account_selection", "pending_id": "abc123"})
    error = service.dashboard_oauth_return_url("google_ads", error="OAuth failed")

    assert success == "/?section=connections&provider=google_ads&status=pending_account_selection&pending_id=abc123"
    assert error == "/?section=connections&provider=google_ads&status=error&oauth_error=OAuth+failed"


def test_oauth_diagnostics_reports_missing_env_without_secrets(tmp_path: Path) -> None:
    settings = Settings(project_root=tmp_path, public_base_url="https://mcp.adforge.dev")
    service = HostedConnectionService(settings)

    payload = service.oauth_diagnostics("google_ads")
    google = payload["providers"][0]

    assert payload["live_credentials_checked"] is False
    assert google["status"] == "missing_env"
    assert google["missing_required_env"] == [
        "AD_MCP_GOOGLE_OAUTH_CLIENT_ID",
        "AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET",
        "AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN",
    ]
    assert google["redirect_url"] == "https://mcp.adforge.dev/oauth/google/callback"


def test_oauth_diagnostics_marks_configured_provider(tmp_path: Path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.adforge.dev",
        google_oauth_client_id="client-id",
        google_oauth_client_secret="client-secret",
        google_ads_developer_token="developer-token",
        google_ads_login_customer_id="1234567890",
    )
    service = HostedConnectionService(settings)

    payload = service.oauth_diagnostics("google_ads")
    google = payload["providers"][0]

    assert google["status"] == "configured"
    assert google["missing_required_env"] == []
    assert "client-secret" not in str(payload)
    assert "developer-token" not in str(payload)
    assert "AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID" in google["configured_optional_env"]


def test_next_platform_oauth_stays_client_closed_until_publicly_enabled(tmp_path: Path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.holymedia.kz",
        tiktok_oauth_app_id="tiktok-app-id",
        tiktok_oauth_app_secret="tiktok-app-secret",
        yandex_oauth_client_id="yandex-client-id",
        yandex_oauth_client_secret="yandex-client-secret",
    )
    service = HostedConnectionService(settings)

    connections = service.connections()
    tiktok = next(platform for platform in connections["platforms"] if platform["provider"] == "tiktok_ads")
    yandex = next(platform for platform in connections["platforms"] if platform["provider"] == "yandex_direct")
    diagnostics = service.oauth_diagnostics()

    assert tiktok["status"] == "provider_setup_required"
    assert tiktok["oauth_credentials_configured"] is True
    assert tiktok["oauth_configured"] is False
    assert tiktok["oauth_public_enabled"] is False
    assert yandex["status"] == "provider_setup_required"
    assert yandex["oauth_credentials_configured"] is True
    assert yandex["oauth_configured"] is False
    assert yandex["oauth_public_enabled"] is False
    assert "tiktok-app-secret" not in str(diagnostics)
    assert "yandex-client-secret" not in str(diagnostics)
    assert "https://mcp.holymedia.kz/oauth/tiktok/callback" in str(diagnostics)
    assert "https://mcp.holymedia.kz/oauth/yandex/callback" in str(diagnostics)


def test_next_platform_oauth_can_be_publicly_enabled_after_provider_dashboard_check(tmp_path: Path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.holymedia.kz",
        tiktok_oauth_app_id="tiktok-app-id",
        tiktok_oauth_app_secret="tiktok-app-secret",
        tiktok_oauth_public_enabled=True,
    )
    service = HostedConnectionService(settings)

    preview = service.oauth_start_preview("tiktok_ads")
    info = service.oauth_authorization_info("tiktok_ads")

    assert preview["status"] == "oauth_ready"
    assert preview["public_connection_enabled"] is True
    assert info["status"] == "oauth_ready"
    assert "tiktok-app-secret" not in str(info)


def test_oauth_readiness_reports_all_live_redirects_and_blockers_without_secrets(tmp_path: Path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.holymedia.kz",
        tiktok_oauth_app_id="tiktok-app-id",
        tiktok_oauth_app_secret="tiktok-app-secret",
        yandex_oauth_client_id="yandex-client-id",
        yandex_oauth_client_secret="yandex-client-secret",
    )
    service = HostedConnectionService(settings)

    readiness = service.oauth_readiness()
    platforms = {item["provider"]: item for item in readiness["platforms"]}

    assert readiness["summary"] == {"platform_count": 4, "ready_to_connect": 0, "blocked": 4}
    assert platforms["meta_ads"]["expected_redirect_url"] == "https://mcp.holymedia.kz/oauth/meta/callback"
    assert platforms["google_ads"]["expected_redirect_url"] == "https://mcp.holymedia.kz/oauth/google/callback"
    assert platforms["tiktok_ads"]["expected_redirect_url"] == "https://mcp.holymedia.kz/oauth/tiktok/callback"
    assert platforms["yandex_direct"]["expected_redirect_url"] == "https://mcp.holymedia.kz/oauth/yandex/callback"
    assert platforms["meta_ads"]["overall_status"] == "blocked_missing_credentials"
    assert platforms["google_ads"]["overall_status"] == "blocked_missing_credentials"
    assert platforms["tiktok_ads"]["overall_status"] == "blocked_provider_dashboard_check"
    assert platforms["yandex_direct"]["overall_status"] == "blocked_provider_dashboard_check"
    assert platforms["tiktok_ads"]["authorize_url"]["status"] == "blocked_public_disabled"
    assert platforms["yandex_direct"]["authorize_url"]["status"] == "blocked_public_disabled"
    assert "tiktok-app-secret" not in str(readiness)
    assert "yandex-client-secret" not in str(readiness)


def test_oauth_readiness_marks_google_ready_when_credentials_are_present(tmp_path: Path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://mcp.holymedia.kz",
        google_oauth_client_id="google-client-id",
        google_oauth_client_secret="google-client-secret",
        google_ads_developer_token="developer-token",
    )
    service = HostedConnectionService(settings)

    readiness = service.oauth_readiness("google_ads")
    google = readiness["platforms"][0]

    assert readiness["summary"] == {"platform_count": 1, "ready_to_connect": 1, "blocked": 0}
    assert google["overall_status"] == "ready_to_connect"
    assert google["connect_button_enabled"] is True
    assert google["authorize_url"]["status"] == "ready"
    assert google["authorize_url"]["redirect_uri"] == "https://mcp.holymedia.kz/oauth/google/callback"
    assert "google-client-secret" not in str(readiness)
    assert "developer-token" not in str(readiness)


def test_import_local_provider_writes_hosted_store_without_exposing_secrets(tmp_path: Path) -> None:
    config = tmp_path / "ads_config.yaml"
    config.write_text(
        """
providers:
  meta_ads:
    provider: meta_ads
    accounts:
      - name: Client Meta
        account_id: "act_123"
        app_secret: super-secret
        access_token: token-value
""",
        encoding="utf-8",
    )
    settings = Settings(project_root=tmp_path, connections_config="ads_config.yaml", connection_store_path="tokens/connections.json")
    service = HostedConnectionService(settings)

    payload = service.import_local_provider("meta_ads")
    connections = service.connections()
    text = str(payload)

    assert payload["status"] == "imported"
    assert settings.connection_store_file.exists()
    assert "super-secret" not in text
    assert "token-value" not in text
    assert connections["platforms"][0]["source"] == "hosted_connection_store"


def test_import_local_provider_does_not_import_example_config(tmp_path: Path) -> None:
    example = tmp_path / "ads_config.example.yaml"
    example.write_text(
        """
providers:
  meta_ads:
    provider: meta_ads
    accounts:
      - name: Example Meta
        account_id: "example"
        access_token: "YOUR_TOKEN"
""",
        encoding="utf-8",
    )
    settings = Settings(project_root=tmp_path, connections_config="ads_config.yaml", connection_store_path="tokens/connections.json")
    service = HostedConnectionService(settings)

    payload = service.import_local_provider("meta_ads")

    assert payload["status"] == "no_local_config"
    assert not settings.connection_store_file.exists()


def test_connections_response_exposes_pending_and_disconnects_provider(tmp_path: Path) -> None:
    settings = Settings(project_root=tmp_path, connections_config="missing.yaml", connection_store_path="tokens/connections.json")
    store = HostedConnectionStore(settings.connection_store_file)
    pending = store.save_oauth_pending(
        "google_ads",
        [{"name": "Google Client", "customer_id": "1234567890"}],
        credentials={"refresh_token": "refresh-token"},
    )
    service = HostedConnectionService(settings)

    payload = service.connections()
    google = next(platform for platform in payload["platforms"] if platform["provider"] == "google_ads")
    disconnected = service.disconnect_provider("google_ads")
    after_disconnect = service.connections()
    google_after = next(platform for platform in after_disconnect["platforms"] if platform["provider"] == "google_ads")

    assert google["status"] == "pending_account_selection"
    assert google["pending_selections"][0]["pending_id"] == pending["pending_id"]
    assert "refresh-token" not in str(google)
    assert disconnected["status"] == "disconnected"
    assert google_after["status"] == "not_connected"
    assert google_after["pending_selections"] == []


def test_connections_response_marks_expired_pending_selection(tmp_path: Path) -> None:
    settings = Settings(project_root=tmp_path, connections_config="missing.yaml", connection_store_path="tokens/connections.json")
    store = HostedConnectionStore(settings.connection_store_file)
    pending = store.save_oauth_pending(
        "meta_ads",
        [{"name": "Meta Client", "account_id": "act_123"}],
        credentials={"access_token": "access-token"},
    )
    data = store.read()
    data["oauth_pending"]["meta_ads"][pending["pending_id"]]["expires_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=30)
    ).isoformat()
    store._write(data)  # noqa: SLF001
    service = HostedConnectionService(settings)

    payload = service.connections()
    meta = next(platform for platform in payload["platforms"] if platform["provider"] == "meta_ads")

    assert meta["status"] == "expired/reconnect_required"
    assert meta["pending_selections"][0]["status"] == "expired"
    assert "access-token" not in str(meta)

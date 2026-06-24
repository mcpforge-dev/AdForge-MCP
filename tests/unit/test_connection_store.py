from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ad_mcp.core.connection_store import HostedConnectionStore, load_runtime_provider_configs
from ad_mcp.settings import Settings


def test_connection_store_saves_secrets_but_returns_safe_status(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "tokens" / "connections.json")

    status = store.save_provider_config(
        "meta_ads",
        {
            "provider": "meta_ads",
            "accounts": [
                {
                    "name": "Client Meta",
                    "account_id": "act_123",
                    "status": "connected",
                    "app_id": "app-id",
                    "app_secret": "app-secret",
                    "access_token": "access-token",
                }
            ],
        },
        source="dashboard_oauth",
    )
    runtime_config = store.provider_config("meta_ads")
    serialized_status = json.dumps(status)

    assert runtime_config["accounts"][0]["access_token"] == "access-token"
    assert runtime_config["accounts"][0]["app_secret"] == "app-secret"
    assert "access-token" not in serialized_status
    assert "app-secret" not in serialized_status
    assert status["accounts"][0]["credentials_present"] is True


def test_runtime_provider_configs_prefer_hosted_store_over_local_config(tmp_path: Path) -> None:
    local_config = tmp_path / "ads_config.yaml"
    local_config.write_text(
        """
providers:
  meta_ads:
    provider: meta_ads
    accounts:
      - name: Local Meta
        account_id: local_1
        status: configured
""",
        encoding="utf-8",
    )
    settings = Settings(project_root=tmp_path, connections_config="ads_config.yaml", connection_store_path="tokens/connections.json")
    store = HostedConnectionStore(settings.connection_store_file)
    store.save_provider_config(
        "meta_ads",
        {"provider": "meta_ads", "accounts": [{"name": "Hosted Meta", "account_id": "hosted_1", "status": "connected"}]},
    )

    configs, sources = load_runtime_provider_configs(settings)

    assert sources["meta_ads"] == "hosted_connection_store"
    assert configs["meta_ads"]["accounts"][0]["name"] == "Hosted Meta"


def test_connection_store_isolates_accounts_by_workspace(tmp_path: Path) -> None:
    settings = Settings(project_root=tmp_path, connection_store_path="tokens/connections.json", connections_fallback_to_local=False)
    store = HostedConnectionStore(settings.connection_store_file)
    store.save_provider_config(
        "meta_ads",
        {"provider": "meta_ads", "accounts": [{"name": "Workspace A Meta", "account_id": "act_a"}]},
        workspace_id="workspace-a",
        user_id="user-a",
    )
    store.save_provider_config(
        "meta_ads",
        {"provider": "meta_ads", "accounts": [{"name": "Workspace B Meta", "account_id": "act_b"}]},
        workspace_id="workspace-b",
        user_id="user-b",
    )

    configs_a, sources_a = load_runtime_provider_configs(settings, workspace_id="workspace-a")
    configs_b, sources_b = load_runtime_provider_configs(settings, workspace_id="workspace-b")
    configs_empty, sources_empty = load_runtime_provider_configs(settings, workspace_id="workspace-empty")
    configs_global, sources_global = load_runtime_provider_configs(settings)

    assert sources_a["meta_ads"] == "hosted_connection_store_scoped"
    assert configs_a["meta_ads"]["accounts"][0]["account_id"] == "act_a"
    assert sources_b["meta_ads"] == "hosted_connection_store_scoped"
    assert configs_b["meta_ads"]["accounts"][0]["account_id"] == "act_b"
    assert sources_empty["meta_ads"] == "empty"
    assert configs_empty["meta_ads"]["accounts"] == []
    assert sources_global["meta_ads"] == "empty"
    assert configs_global["meta_ads"]["accounts"] == []


def test_scoped_runtime_configs_do_not_fallback_to_local_config(tmp_path: Path) -> None:
    local_config = tmp_path / "ads_config.yaml"
    local_config.write_text(
        """
providers:
  meta_ads:
    provider: meta_ads
    accounts:
      - name: Local Meta
        account_id: local_1
""",
        encoding="utf-8",
    )
    settings = Settings(project_root=tmp_path, connections_config="ads_config.yaml", connection_store_path="tokens/connections.json")

    scoped_configs, scoped_sources = load_runtime_provider_configs(settings, workspace_id="workspace-a")
    global_configs, global_sources = load_runtime_provider_configs(settings)

    assert scoped_sources["meta_ads"] == "empty"
    assert scoped_configs["meta_ads"]["accounts"] == []
    assert global_sources["meta_ads"] == "local_connections_config"
    assert global_configs["meta_ads"]["accounts"][0]["account_id"] == "local_1"


def test_runtime_provider_configs_can_disable_local_fallback(tmp_path: Path) -> None:
    local_config = tmp_path / "ads_config.yaml"
    local_config.write_text(
        """
providers:
  meta_ads:
    provider: meta_ads
    accounts:
      - name: Local Meta
        account_id: local_1
""",
        encoding="utf-8",
    )
    settings = Settings(project_root=tmp_path, connections_config="ads_config.yaml", connections_fallback_to_local=False)

    configs, sources = load_runtime_provider_configs(settings)

    assert sources["meta_ads"] == "empty"
    assert configs["meta_ads"]["accounts"] == []


def test_google_customer_id_becomes_account_id_for_oauth_store(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "tokens" / "connections.json")
    store.save_provider_config(
        "google_ads",
        {
            "provider": "google_ads",
            "accounts": [
                {
                    "name": "Google Client",
                    "customer_id": "123-456-7890",
                    "refresh_token": "refresh-token",
                }
            ],
        },
    )

    config = store.provider_config("google_ads")

    assert config["accounts"][0]["account_id"] == "123-456-7890"


def test_safe_account_summary_keeps_provider_metadata_without_secrets(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "tokens" / "connections.json")
    store.save_provider_config(
        "tiktok_ads",
        {
            "provider": "tiktok_ads",
            "accounts": [
                {
                    "name": "TikTok Advertiser",
                    "account_id": "744",
                    "advertiser_id": "744",
                    "app_name": "HolyMedia MCP",
                    "app_id": "app-id",
                    "verification_status": "Approved",
                    "requested_permissions": ["Reporting", "Ads Management"],
                    "secret": "tiktok-secret",
                }
            ],
        },
    )
    store.save_provider_config(
        "yandex_direct",
        {
            "provider": "yandex_direct",
            "accounts": [
                {
                    "name": "Yandex Client",
                    "account_id": "client-login",
                    "login": "agency-login",
                    "direct_client_login": "client-login",
                    "api_access_status": "opened",
                    "api_points": 32000,
                    "access_token": "yandex-token",
                }
            ],
        },
    )

    tiktok = store.safe_provider_status("tiktok_ads")["accounts"][0]
    yandex = store.safe_provider_status("yandex_direct")["accounts"][0]
    serialized = json.dumps({"tiktok": tiktok, "yandex": yandex})

    assert tiktok["app_name"] == "HolyMedia MCP"
    assert tiktok["verification_status"] == "Approved"
    assert tiktok["requested_permissions"] == ["Reporting", "Ads Management"]
    assert yandex["direct_client_login"] == "client-login"
    assert yandex["api_access_status"] == "opened"
    assert yandex["api_points"] == "32000"
    assert "tiktok-secret" not in serialized
    assert "yandex-token" not in serialized


def test_pending_selections_are_safe_and_disconnect_clears_provider(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "tokens" / "connections.json")
    pending = store.save_oauth_pending(
        "google_ads",
        [{"name": "Google Client", "customer_id": "1234567890"}],
        credentials={
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "developer_token": "developer-token",
        },
    )
    store.save_provider_config(
        "google_ads",
        {"provider": "google_ads", "accounts": [{"name": "Google Client", "customer_id": "1234567890", "refresh_token": "refresh-token"}]},
    )

    pending_status = store.pending_selections("google_ads")
    serialized_pending = json.dumps(pending_status)
    disconnected = store.disconnect_provider("google_ads")

    assert pending_status[0]["pending_id"] == pending["pending_id"]
    assert pending_status[0]["status"] == "pending_account_selection"
    assert pending_status[0]["accounts"][0]["customer_id"] == "1234567890"
    assert "access-token" not in serialized_pending
    assert "refresh-token" not in serialized_pending
    assert "developer-token" not in serialized_pending
    assert disconnected["accounts"] == []
    assert store.provider_config("google_ads")["accounts"] == []
    assert store.pending_selections("google_ads") == []


def test_save_oauth_state_prunes_expired_states(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "tokens" / "connections.json")
    store.save_oauth_state("meta_ads", "abandoned-state", ttl_seconds=900)
    data = store.read()
    data["oauth_states"]["meta_ads"]["abandoned-state"]["expires_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=30)
    ).isoformat()
    store._write(data)  # noqa: SLF001

    store.save_oauth_state("meta_ads", "fresh-state", ttl_seconds=900)
    states = store.read()["oauth_states"]["meta_ads"]

    assert "abandoned-state" not in states
    assert "fresh-state" in states


def test_pending_selections_mark_expired_records(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "tokens" / "connections.json")
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

    pending_status = store.pending_selections("meta_ads")

    assert pending_status[0]["status"] == "expired"


def test_select_pending_accounts_clears_stale_provider_pending_records(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "connections.json")
    first = store.save_oauth_pending(
        "yandex_direct",
        [{"name": "Yandex Client", "account_id": "client-login", "direct_client_login": "client-login"}],
        credentials={"access_token": "access-token"},
    )
    store.save_oauth_pending(
        "yandex_direct",
        [{"name": "Yandex Client", "account_id": "client-login", "direct_client_login": "client-login"}],
        credentials={"access_token": "new-access-token"},
    )

    selected = store.select_pending_accounts("yandex_direct", first["pending_id"], ["client-login"])

    assert selected["status"] == "connected"
    assert store.pending_selections("yandex_direct") == []
    assert store.safe_provider_status("yandex_direct")["accounts"][0]["account_id"] == "client-login"


def test_oauth_pending_metadata_is_safe_and_archived_accounts_are_not_selected(tmp_path: Path) -> None:
    store = HostedConnectionStore(tmp_path / "connections.json")
    pending = store.save_oauth_pending(
        "yandex_direct",
        [
            {"name": "Active Yandex Client", "account_id": "active-login", "direct_client_login": "active-login"},
            {
                "name": "Archived Yandex Client",
                "account_id": "archived-login",
                "direct_client_login": "archived-login",
                "yandex_archived": "YES",
                "selection_disabled": True,
                "disabled_reason": "Архивный/отключённый кабинет",
            },
        ],
        credentials={"access_token": "access-token"},
        metadata={
            "api_clients_returned": 2,
            "archived_clients": 1,
            "fallback_used": False,
            "access_token": "must-not-leak",
        },
    )

    pending_again = store.pending_selection("yandex_direct", pending["pending_id"])
    selected = store.select_pending_accounts("yandex_direct", pending["pending_id"], ["active-login", "archived-login"])

    assert pending_again["metadata"] == {"api_clients_returned": 2, "archived_clients": 1, "fallback_used": False}
    archived = next(account for account in pending_again["accounts"] if account["account_id"] == "archived-login")
    assert archived["selection_disabled"] == "True"
    assert archived["disabled_reason"] == "Архивный/отключённый кабинет"
    assert [account["account_id"] for account in selected["accounts"]] == ["active-login"]

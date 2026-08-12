from ad_mcp.web.service import MetaDashboardService
from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.settings import Settings


def test_date_window_defaults_to_requested_lookback() -> None:
    service = MetaDashboardService()
    start_date, _, end_date = service._date_window(end_date="2026-05-05", lookback_days=7)
    assert start_date == "2026-04-29"
    assert end_date == "2026-05-05"


def test_count_statuses_falls_back_to_status_field() -> None:
    service = MetaDashboardService()
    result = service._count_statuses(
        [
            {"effective_status": "ACTIVE"},
            {"status": "PAUSED"},
            {},
        ]
    )
    assert result == {"ACTIVE": 1, "PAUSED": 1, "UNKNOWN": 1}


def test_config_diagnostics_uses_hosted_connection_store(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    HostedConnectionStore(settings.connection_store_file).save_provider_config(
        "meta_ads",
        {
            "provider": "meta_ads",
            "accounts": [
                {
                    "name": "Hosted Meta",
                    "account_id": "hosted_123",
                    "status": "connected",
                    "app_id": "app-id",
                    "app_secret": "app-secret",
                    "access_token": "access-token",
                }
            ],
        },
    )
    service = MetaDashboardService(settings)

    payload = service.config_diagnostics()

    assert payload["connections"]["runtime_source"] == "hosted_connection_store"
    assert payload["runtime"]["accounts_total"] == 1
    assert payload["runtime"]["accounts"][0]["account_id"] == "hosted_123"


def test_workspace_scoped_dashboard_service_cannot_load_another_workspace(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=True,
    )
    assert settings.connections_fallback_to_local is False
    store = HostedConnectionStore(settings.connection_store_file)
    for workspace_id, account_id in (("workspace-a", "act_a"), ("workspace-b", "act_b")):
        store.save_provider_config(
            "meta_ads",
            {"provider": "meta_ads", "accounts": [{"account_id": account_id, "name": account_id}]},
            workspace_id=workspace_id,
        )

    service_a = MetaDashboardService(settings, workspace_id="workspace-a")
    service_b = MetaDashboardService(settings, workspace_id="workspace-b")

    assert [item["account_id"] for item in service_a._provider.config["accounts"]] == ["act_a"]
    assert [item["account_id"] for item in service_b._provider.config["accounts"]] == ["act_b"]


def test_monthly_report_reads_only_signed_in_workspace(tmp_path, monkeypatch) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = HostedConnectionStore(settings.connection_store_file)
    store.save_provider_config(
        "meta_ads",
        {
            "provider": "meta_ads",
            "accounts": [
                {
                    "name": "Workspace A account",
                    "account_id": "act_workspace_a",
                    "app_id": "app-id",
                    "app_secret": "real-secret",
                    "access_token": "real-token",
                }
            ],
        },
        workspace_id="workspace-a",
    )
    service = MetaDashboardService(settings)
    monkeypatch.setattr(
        "ad_mcp.web.service.collect_monthly_ads_report",
        lambda _provider, **kwargs: {"account_id": kwargs["account_id"], "provider": kwargs["provider"]},
    )

    class User:
        workspace_id = "workspace-a"

    report = service.build_monthly_ads_report_for_user(User(), account_id="act_workspace_a", end_date="2026-06-07", lookback_days=7)

    assert report == {"account_id": "act_workspace_a", "provider": "meta_ads"}


class _FakeMetaProvider:
    def __init__(self) -> None:
        self.config = {"accounts": [{"account_id": "act_123", "name": "Demo account", "status": "configured", "app_id": "app_1"}]}

    def get_account_summary(self, account_id: str, fields=None) -> dict:
        return {"data": {"id": account_id, "name": "Demo account", "currency": "USD", "timezone_name": "UTC"}}

    def get_billing_summary(self, account_id: str) -> dict:
        return {"billing": {"balance_due": 0, "currency": "USD", "account_name": "Demo account"}}

    def get_spend_overview(self, account_id: str, end_date: str) -> dict:
        return {
            "periods": [
                {"period": "today", "spend": 10},
                {"period": "last_7_days", "spend": 70},
                {"period": "last_30_days", "spend": 300, "impressions": 1000, "clicks": 50, "conversions": 4, "ctr": 5},
            ]
        }

    def list_account_objects(self, account_id: str, object_type: str, limit: int = 0) -> dict:
        if object_type == "campaign":
            return {"rows": [{"id": "cmp_1", "name": "Campaign 1", "status": "ACTIVE", "effective_status": "ACTIVE"}]}
        if object_type == "adset":
            return {"rows": [{"id": "adset_1", "name": "Adset 1", "campaign_id": "cmp_1", "status": "ACTIVE", "effective_status": "ACTIVE"}]}
        if object_type == "ad":
            return {"rows": [{"id": "ad_1", "name": "Ad 1", "adset_id": "adset_1", "status": "ACTIVE", "effective_status": "ACTIVE"}]}
        return {"rows": []}

    def get_delivery_issues(self, account_id: str, limit: int) -> dict:
        return {"issues": [], "issue_count": 0}

    def get_connected_assets(self, account_id: str) -> dict:
        return {"pages": [], "instagram_accounts": [], "pixels": [], "custom_conversions": []}

    def rank_top_entities(
        self,
        account_id: str,
        entity_level: str,
        start_date: str,
        end_date: str,
        metric: str,
        limit: int,
    ) -> dict:
        if metric == "spend":
            return {"rows": [{"entity_id": "ad_1", "entity_name": "Ad 1", "spend": 25, "conversions": 0, "ctr": 1.2}]}
        return {"rows": [{"entity_id": "cmp_1", "entity_name": "Campaign 1", "spend": 80, "conversions": 3, "cost_per_result": 12, "ctr": 2.4}]}


def test_dashboard_returns_partial_payload_when_some_meta_calls_fail(monkeypatch) -> None:
    service = MetaDashboardService()
    service._provider = _FakeMetaProvider()
    monkeypatch.setattr(service, "_ensure_account_is_usable", lambda account_id: None)

    original_list = service._provider.list_account_objects

    def _broken_list(account_id: str, object_type: str, limit: int = 0) -> dict:
        if object_type == "adset":
            raise RuntimeError("слишком много вызовов API из рекламного аккаунта")
        return original_list(account_id, object_type, limit)

    monkeypatch.setattr(service._provider, "list_account_objects", _broken_list)

    payload = service.dashboard("act_123", "2026-06-03")

    assert payload["totals"]["campaigns"] == 1
    assert payload["totals"]["adsets"] == 0
    assert payload["totals"]["ads"] == 1
    assert payload["warnings"]
    assert "частичные данные" in payload["warnings"][0].lower()


def test_workspace_bootstrap_skips_expensive_auth_diagnostics(monkeypatch) -> None:
    service = MetaDashboardService()
    service._provider = _FakeMetaProvider()
    monkeypatch.setattr(service, "_ensure_account_is_usable", lambda account_id: None)
    monkeypatch.setattr(
        service,
        "config_diagnostics",
        lambda: {
            "provider_loaded": True,
            "runtime": {"accounts_total": 1},
            "env": {"exists": True},
            "connections": {"primary_exists": True},
            "env_substitution": {"all_resolved": True, "missing_vars": []},
        },
    )
    monkeypatch.setattr(
        service,
        "persistence_diagnostics",
        lambda: {"enabled": False, "configured": False, "reachable": False},
    )
    monkeypatch.setattr(
        service,
        "auth_diagnostics",
        lambda: (_ for _ in ()).throw(AssertionError("workspace should not call auth_diagnostics on bootstrap")),
    )
    monkeypatch.setattr(
        service,
        "diagnostics_health",
        lambda: (_ for _ in ()).throw(AssertionError("workspace should not call diagnostics_health on bootstrap")),
    )

    payload = service.workspace("act_123", "2026-06-03")

    assert payload["account_id"] == "act_123"
    assert payload["header"]["available_accounts"]
    assert payload["sections"]["diagnostics"]["auth"]["checks"] == []
    assert payload["sections"]["diagnostics"]["health"]["status"] == "deferred"

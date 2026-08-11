from __future__ import annotations

from ad_mcp.core.audit_logger import AuditLogger
from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.core.models import ObjectMutationResponse
from ad_mcp.core.policy import PolicyManager, SafetyPolicy
from ad_mcp.core.preview_manager import PreviewManager
from ad_mcp.providers.google_ads.client import GoogleAdsProvider
from ad_mcp.providers.meta_ads.client import MetaAdsProvider
from ad_mcp.providers.tiktok_ads.client import TikTokAdsProvider
from ad_mcp.settings import Settings
from ad_mcp.tools.dangerous_preview import build_dangerous_preview_tools
from ad_mcp.tools.write_commit import build_write_commit_tools


class FakeGoogleAdsProvider(GoogleAdsProvider):
    def __init__(self) -> None:
        super().__init__(config={"accounts": [{"account_id": "123", "name": "Test", "currency": "USD"}]})
        self.commit_called = False

    def get_account_object(self, account_id: str, object_type: str, object_id: str, fields: list[str] | None = None) -> dict:
        return {
            "provider": "google_ads",
            "account_id": account_id,
            "object_type": object_type,
            "object_id": object_id,
            "data": {
                "id": object_id,
                "name": "Campaign One",
                "status": "ENABLED",
                "daily_budget": 100,
                "currency": "USD",
            },
            "source_api": "unit_test",
            "preview": False,
        }

    def commit_preview(self, preview):
        self.commit_called = True
        raise AssertionError("commit_preview must not be called in preview-only beta.")


class FakeMetaAdsProvider(MetaAdsProvider):
    def __init__(self) -> None:
        super().__init__(config={"accounts": [{"account_id": "act_1", "name": "Meta Test"}]})
        self.commits = 0

    def get_account_object(self, account_id: str, object_type: str, object_id: str, fields: list[str] | None = None) -> dict:
        return {
            "provider": "meta_ads",
            "account_id": account_id,
            "object_type": object_type,
            "object_id": object_id,
            "data": {"id": object_id, "name": "Before", "status": "PAUSED"},
            "source_api": "unit_test",
            "preview": False,
        }

    def list_meta_permissions(self, account_id: str) -> dict:
        return {"granted": ["ads_management"]}

    def commit_confirmed_write(self, preview, *, require_paused_objects: bool = True):
        self.commits += 1
        assert require_paused_objects is True
        assert preview.payload == {"name": "After"}
        assert preview.provider_payload == {
            "http_method": "POST",
            "endpoint": "/campaign_1",
            "body": {"name": "After"},
        }
        return ObjectMutationResponse(
            status="committed",
            provider="meta_ads",
            account_id=preview.account_id,
            object_type="campaign",
            action="update",
            diff={
                "before": {"id": "campaign_1", "name": "Before", "status": "PAUSED"},
                "requested": {"name": "After"},
                "after": {"id": "campaign_1", "name": "After", "status": "PAUSED"},
            },
            provider_response={"verified_by_reread": True, "status_preserved": True},
        )


def _settings_with_account(tmp_path) -> Settings:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    HostedConnectionStore(settings.connection_store_file).save_provider_config(
        "google_ads",
        {"provider": "google_ads", "accounts": [{"account_id": "123", "name": "Test", "currency": "USD"}]},
    )
    return settings


def _meta_confirmed_settings(tmp_path) -> Settings:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
        env="beta",
        preview_only=True,
        meta_ads_management_oauth_enabled=True,
        meta_confirmed_write_enabled=True,
        meta_confirmed_write_allowed_account_ids="act_1",
        meta_confirmed_write_allowed_object_ids="campaign_1",
        meta_confirmed_write_allowed_actions="change_name",
        meta_confirmed_write_require_paused_objects=True,
    )
    HostedConnectionStore(settings.connection_store_file).save_provider_config(
        "meta_ads",
        {"provider": "meta_ads", "accounts": [{"account_id": "act_1", "name": "Meta Test"}]},
    )
    return settings


def test_legacy_meta_rename_preview_uses_confirmed_write_flow_without_null_fields(tmp_path) -> None:
    settings = _meta_confirmed_settings(tmp_path)
    provider = FakeMetaAdsProvider()
    registry = CapabilityRegistry({"meta_ads": provider})
    manager = PreviewManager()
    policy = PolicyManager(SafetyPolicy(preview_only=True))
    audit = AuditLogger(tmp_path / "audit.jsonl")
    previews = build_dangerous_preview_tools(registry, manager, audit, policy, settings)
    commits = build_write_commit_tools(registry, manager, audit, policy, settings)

    preview = previews["preview_change_campaign_name"]("meta_ads", "act_1", "campaign_1", "After")

    assert preview["mode"] == "preview_confirm"
    assert preview["will_apply"] is False
    assert preview["app_review_commit_available"] is True
    assert preview["confirmed_write_available"] is True
    assert preview["commit_available_after_confirmation"] is True
    assert preview["commit_tool"] == "commit_meta_confirmed_write"
    assert preview["provider_request"] == {
        "http_method": "POST",
        "endpoint": "/campaign_1",
        "body": {"name": "After"},
    }
    assert preview["diff"]["requested"] == {"name": "After"}
    assert preview["explicit_confirmation"] == f"CONFIRM META WRITE {preview['preview_token']}"

    committed = commits["commit_meta_confirmed_write"](
        preview["preview_token"],
        preview["explicit_confirmation"],
    )

    assert committed["status"] == "committed"
    assert committed["diff"]["after"] == {"id": "campaign_1", "name": "After", "status": "PAUSED"}
    assert committed["provider_response"]["status_preserved"] is True
    assert provider.commits == 1


def test_preview_pause_campaign_reads_current_state_and_never_applies(tmp_path) -> None:
    settings = _settings_with_account(tmp_path)
    provider = FakeGoogleAdsProvider()
    registry = CapabilityRegistry({"google_ads": provider})
    preview_manager = PreviewManager()
    policy_manager = PolicyManager(SafetyPolicy(preview_only=True, execution_mode="live_write"))
    audit_logger = AuditLogger(tmp_path / "audit.jsonl")
    tools = build_dangerous_preview_tools(registry, preview_manager, audit_logger, policy_manager, settings)

    result = tools["preview_pause_campaign"]("google_ads", "123", "456")

    assert result["status"] == "preview"
    assert result["mode"] == "preview_only"
    assert result["will_apply"] is False
    assert result["object_type"] == "campaign"
    assert result["object_id"] == "456"
    assert result["object_name"] == "Campaign One"
    assert result["action"] == "pause_campaign"
    assert result["current_value"] == "ENABLED"
    assert result["requested_value"] == "PAUSED"
    assert result["reason"] == "Beta MVP работает в preview-only mode. Реальные изменения отключены."
    assert preview_manager.get(result["preview_token"]).payload["status"] == "PAUSED"
    assert provider.commit_called is False


def test_preview_budget_change_marks_large_delta_high_risk(tmp_path) -> None:
    settings = _settings_with_account(tmp_path)
    provider = FakeGoogleAdsProvider()
    registry = CapabilityRegistry({"google_ads": provider})
    preview_manager = PreviewManager()
    policy_manager = PolicyManager(SafetyPolicy(preview_only=True, max_budget_delta_percent=30))
    tools = build_dangerous_preview_tools(
        registry,
        preview_manager,
        AuditLogger(tmp_path / "audit.jsonl"),
        policy_manager,
        settings,
    )

    result = tools["preview_change_campaign_budget"]("google_ads", "123", "456", daily_budget=200)

    assert result["mode"] == "preview_only"
    assert result["will_apply"] is False
    assert result["current_value"] == "100 USD/day"
    assert result["requested_value"] == "200 USD/day"
    assert result["risk_level"] == "high"


def test_preview_returns_error_when_current_state_is_unavailable(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    HostedConnectionStore(settings.connection_store_file).save_provider_config(
        "tiktok_ads",
        {"provider": "tiktok_ads", "accounts": [{"account_id": "adv_1", "status": "connected"}]},
    )
    registry = CapabilityRegistry({"tiktok_ads": TikTokAdsProvider(config={"accounts": [{"account_id": "adv_1"}]})})
    tools = build_dangerous_preview_tools(
        registry,
        PreviewManager(),
        AuditLogger(tmp_path / "audit.jsonl"),
        PolicyManager(SafetyPolicy(preview_only=True)),
        settings,
    )

    result = tools["preview_pause_campaign"]("tiktok_ads", "adv_1", "cmp_1")

    assert result["status"] == "error"
    assert result["mode"] == "preview_only"
    assert result["will_apply"] is False
    assert "Object retrieval is not implemented" in result["error"]


def test_commit_preview_is_blocked_by_preview_only_even_if_execution_mode_changes(tmp_path) -> None:
    provider = FakeGoogleAdsProvider()
    registry = CapabilityRegistry({"google_ads": provider})
    preview_manager = PreviewManager()
    preview = preview_manager.create(
        provider.preview_mutation(
            action="update",
            account_id="123",
            object_type="campaign",
            payload={"status": "PAUSED"},
        )
    )
    tools = build_write_commit_tools(
        registry,
        preview_manager,
        AuditLogger(tmp_path / "audit.jsonl"),
        PolicyManager(SafetyPolicy(preview_only=True, execution_mode="live_write")),
    )

    result = tools["commit_preview"](preview.token)

    assert result["status"] == "blocked"
    assert result["provider_response"]["mode"] == "preview_only"
    assert provider.commit_called is False

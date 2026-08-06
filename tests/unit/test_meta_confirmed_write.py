from __future__ import annotations

import pytest

from ad_mcp.core.audit_logger import AuditLogger
from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.errors import PolicyViolationError, PreviewNotFoundError
from ad_mcp.core.models import ObjectMutationResponse, PreviewRecord
from ad_mcp.core.policy import PolicyManager, SafetyPolicy
from ad_mcp.core.preview_manager import PreviewManager
from ad_mcp.providers.meta_ads import mutations
from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.client import MetaAdsProvider
from ad_mcp.settings import Settings
from ad_mcp.tools.meta_write import build_meta_write_tools
from ad_mcp.tools.write_commit import build_write_commit_tools


class _MetaProvider(MetaAdsProvider):
    def __init__(self, *, permission: bool = True) -> None:
        super().__init__(
            config={
                "accounts": [
                    {
                        "account_id": "act_1",
                        "app_id": "app",
                        "app_secret": "secret",
                        "access_token": "token",
                    }
                ]
            }
        )
        self.permission = permission
        self.commits = 0

    def get_account_object(self, account_id, object_type, object_id, fields=None):
        return {
            "data": {
                "id": object_id,
                "name": "Before",
                "status": "PAUSED",
                "effective_status": "PAUSED",
                "daily_budget": "1000",
            }
        }

    def list_meta_permissions(self, account_id):
        return {"granted": ["ads_management"] if self.permission else ["ads_read"]}

    def commit_confirmed_write(self, preview, *, require_paused_objects=True):
        self.commits += 1
        return ObjectMutationResponse(
            status="committed",
            provider="meta_ads",
            account_id=preview.account_id,
            object_type=preview.object_type,
            action=preview.action,
            provider_response={"verified_by_reread": True},
        )


def _settings(tmp_path, **overrides) -> Settings:
    values = {
        "project_root": tmp_path,
        "env": "staging",
        "preview_only": True,
        "meta_ads_management_oauth_enabled": True,
        "meta_confirmed_write_enabled": True,
        "meta_confirmed_write_allowed_account_ids": "act_1",
    }
    values.update(overrides)
    return Settings(**values)


def _tools(tmp_path, provider: _MetaProvider, settings: Settings):
    registry = CapabilityRegistry({"meta_ads": provider})
    manager = PreviewManager()
    audit = AuditLogger(tmp_path / "audit.jsonl")
    policy = PolicyManager(SafetyPolicy(preview_only=True))
    previews = build_meta_write_tools(registry, manager, audit, policy, settings)
    commits = build_write_commit_tools(registry, manager, audit, policy, settings)
    return previews, commits, manager


def test_meta_create_campaign_preview_is_paused_and_uses_real_endpoint(tmp_path) -> None:
    previews, _commits, _manager = _tools(tmp_path, _MetaProvider(), _settings(tmp_path))

    result = previews["preview_meta_create_campaign"](
        "act_1",
        "Review campaign",
        "OUTCOME_TRAFFIC",
        [],
        2500,
    )

    assert result["status"] == "preview"
    assert result["will_apply"] is False
    assert result["confirmed_write_available"] is True
    assert result["provider_payload"]["endpoint"] == "/act_1/campaigns"
    assert result["provider_payload"]["body"]["status"] == "PAUSED"
    assert result["provider_payload"]["body"]["daily_budget"] == 2500
    assert result["explicit_confirmation"].startswith("CONFIRM META WRITE ")


@pytest.mark.parametrize(
    ("object_type", "payload", "endpoint"),
    [
        (
            "campaign",
            {"name": "Campaign", "objective": "OUTCOME_TRAFFIC", "status": "PAUSED"},
            "/act_1/campaigns",
        ),
        (
            "adset",
            {
                "name": "Ad set",
                "campaign_id": "campaign_1",
                "billing_event": "IMPRESSIONS",
                "optimization_goal": "LINK_CLICKS",
                "targeting": {"geo_locations": {"countries": ["KZ"]}},
                "status": "PAUSED",
            },
            "/act_1/adsets",
        ),
        (
            "creative",
            {"name": "Creative", "object_story_id": "page_1_post_1"},
            "/act_1/adcreatives",
        ),
        (
            "ad",
            {"name": "Ad", "adset_id": "adset_1", "creative_id": "creative_1", "status": "PAUSED"},
            "/act_1/ads",
        ),
    ],
)
def test_meta_create_request_uses_supported_graph_endpoints(object_type, payload, endpoint) -> None:
    request = mutations.build_meta_write_request("act_1", "create", object_type, payload)

    assert request["http_method"] == "POST"
    assert request["endpoint"] == endpoint
    if object_type == "ad":
        assert request["body"]["creative"] == {"creative_id": "creative_1"}
        assert "creative_id" not in request["body"]


def test_meta_create_rejects_active_status(tmp_path) -> None:
    previews, _commits, _manager = _tools(tmp_path, _MetaProvider(), _settings(tmp_path))

    with pytest.raises(ValueError, match="PAUSED"):
        previews["preview_meta_create_ad"]("act_1", "adset_1", "Ad", "creative_1", None, "ACTIVE")


def test_meta_update_rejects_budget_change_over_policy_limit(tmp_path) -> None:
    previews, _commits, _manager = _tools(tmp_path, _MetaProvider(), _settings(tmp_path))

    with pytest.raises(PolicyViolationError, match="50.0%"):
        previews["preview_meta_update_campaign"](
            "act_1",
            "campaign_1",
            daily_budget=1500,
        )


def test_meta_preview_does_not_offer_commit_when_write_feature_is_disabled(tmp_path) -> None:
    settings = _settings(tmp_path, meta_confirmed_write_enabled=False)
    previews, _commits, _manager = _tools(tmp_path, _MetaProvider(), settings)

    result = previews["preview_meta_update_campaign"]("act_1", "campaign_1", "After")

    assert result["status"] == "preview"
    assert result["confirmed_write_available"] is False
    assert result["explicit_confirmation"] is None


def test_confirmed_write_requires_exact_confirmation_and_ads_management(tmp_path) -> None:
    provider = _MetaProvider(permission=False)
    previews, commits, manager = _tools(tmp_path, provider, _settings(tmp_path))
    preview = previews["preview_meta_update_campaign"]("act_1", "campaign_1", "After")

    wrong = commits["commit_meta_confirmed_write"](preview["preview_token"], "CONFIRM")
    missing_permission = commits["commit_meta_confirmed_write"](
        preview["preview_token"],
        preview["explicit_confirmation"],
    )

    assert wrong["status"] == "blocked"
    assert missing_permission["status"] == "blocked"
    assert missing_permission["provider_response"]["required_permission"] == "ads_management"
    assert provider.commits == 0
    assert manager.get(preview["preview_token"])


def test_confirmed_write_consumes_one_time_preview(tmp_path) -> None:
    provider = _MetaProvider()
    previews, commits, manager = _tools(tmp_path, provider, _settings(tmp_path))
    preview = previews["preview_meta_update_campaign"]("act_1", "campaign_1", "After")

    result = commits["commit_meta_confirmed_write"](
        preview["preview_token"],
        preview["explicit_confirmation"],
    )

    assert result["status"] == "committed"
    assert result["provider_response"]["verified_by_reread"] is True
    assert provider.commits == 1
    with pytest.raises(PreviewNotFoundError):
        manager.get(preview["preview_token"])


def test_provider_create_posts_once_and_verifies_by_reread(monkeypatch) -> None:
    monkeypatch.setattr(
        mutations,
        "fetch_meta_object",
        lambda *_args, **_kwargs: {
            "data": {
                "id": "campaign_2",
                "name": "New",
                "status": "PAUSED",
                "objective": "OUTCOME_TRAFFIC",
                "special_ad_categories": [],
            }
        },
    )

    class _Graph:
        def __init__(self, _credentials) -> None:
            pass

        def post(self, path, data):
            assert path == "/act_1/campaigns"
            assert data["status"] == "PAUSED"
            return {"id": "campaign_2"}

    monkeypatch.setattr(mutations, "MetaGraphClient", _Graph)
    preview = PreviewRecord(
        provider="meta_ads",
        account_id="act_1",
        object_type="campaign",
        operation="create_campaign",
        action="create",
        payload={
            "name": "New",
            "objective": "OUTCOME_TRAFFIC",
            "special_ad_categories": [],
            "status": "PAUSED",
        },
    )

    result = mutations.commit_meta_confirmed_write(
        MetaAccountCredentials("1", "app", "secret", "token"),
        preview,
    ).model_dump()

    assert result["status"] == "committed"
    assert result["provider_response"]["object_id"] == "campaign_2"
    assert result["provider_response"]["verified_by_reread"] is True


def test_provider_blocks_non_pause_update_on_active_object(monkeypatch) -> None:
    monkeypatch.setattr(
        mutations,
        "fetch_meta_object",
        lambda *_args, **_kwargs: {
            "data": {"id": "campaign_1", "name": "Before", "status": "ACTIVE"}
        },
    )

    class _Graph:
        def __init__(self, _credentials) -> None:
            pass

        def post(self, path, data):
            raise AssertionError("POST must not run for an active object")

    monkeypatch.setattr(mutations, "MetaGraphClient", _Graph)
    preview = PreviewRecord(
        provider="meta_ads",
        account_id="act_1",
        object_type="campaign",
        object_id="campaign_1",
        operation="update_campaign",
        action="update",
        payload={"name": "After"},
    )

    with pytest.raises(ValueError, match="paused"):
        mutations.commit_meta_confirmed_write(
            MetaAccountCredentials("1", "app", "secret", "token"),
            preview,
        )

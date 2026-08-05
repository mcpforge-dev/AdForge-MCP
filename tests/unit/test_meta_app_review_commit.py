from __future__ import annotations

from ad_mcp.core.audit_logger import AuditLogger
from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.models import ObjectMutationResponse, PreviewRecord
from ad_mcp.core.policy import PolicyManager, SafetyPolicy
from ad_mcp.core.preview_manager import PreviewManager
from ad_mcp.providers.meta_ads import mutations
from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.client import MetaAdsProvider
from ad_mcp.settings import Settings
from ad_mcp.tools.write_commit import build_write_commit_tools


class _MetaProvider(MetaAdsProvider):
    def __init__(self) -> None:
        super().__init__(config={"accounts": [{"account_id": "act_1", "app_id": "a", "app_secret": "s", "access_token": "t"}]})
        self.commits = 0

    def commit_app_review_preview(self, preview):
        self.commits += 1
        return ObjectMutationResponse(
            status="committed",
            provider="meta_ads",
            account_id=preview.account_id,
            object_type=preview.object_type,
            action="update",
            provider_response={"verified_by_reread": True},
        )


def _settings(tmp_path) -> Settings:
    return Settings(
        project_root=tmp_path,
        env="staging",
        preview_only=True,
        meta_app_review_commit_enabled=True,
        meta_app_review_allowed_account_id="act_1",
        meta_app_review_allowed_object_ids="campaign_1",
        meta_app_review_allowed_actions="change_name",
    )


def _preview(manager: PreviewManager) -> PreviewRecord:
    return manager.create(
        PreviewRecord(
            provider="meta_ads",
            account_id="act_1",
            object_type="campaign",
            object_id="campaign_1",
            operation="change_name",
            action="update",
            payload={"id": "campaign_1", "name": "Review test"},
        )
    )


def test_meta_review_commit_is_blocked_without_token_bound_confirmation(tmp_path) -> None:
    provider = _MetaProvider()
    manager = PreviewManager()
    preview = _preview(manager)
    tools = build_write_commit_tools(
        CapabilityRegistry({"meta_ads": provider}),
        manager,
        AuditLogger(tmp_path / "audit.jsonl"),
        PolicyManager(SafetyPolicy(preview_only=True)),
        _settings(tmp_path),
    )

    result = tools["commit_meta_app_review_preview"](preview.token, "CONFIRM")

    assert result["status"] == "blocked"
    assert provider.commits == 0
    assert manager.get(preview.token) == preview


def test_meta_review_commit_consumes_preview_after_explicit_confirmation(tmp_path) -> None:
    provider = _MetaProvider()
    manager = PreviewManager()
    preview = _preview(manager)
    tools = build_write_commit_tools(
        CapabilityRegistry({"meta_ads": provider}),
        manager,
        AuditLogger(tmp_path / "audit.jsonl"),
        PolicyManager(SafetyPolicy(preview_only=True)),
        _settings(tmp_path),
    )

    result = tools["commit_meta_app_review_preview"](preview.token, f"CONFIRM {preview.token}")

    assert result["status"] == "committed"
    assert result["provider_response"]["verified_by_reread"] is True
    assert provider.commits == 1


def test_provider_commit_writes_one_field_and_verifies_by_reread(monkeypatch) -> None:
    reads = iter(
        [
            {"data": {"id": "campaign_1", "name": "Before", "status": "PAUSED"}},
            {"data": {"id": "campaign_1", "name": "After", "status": "PAUSED"}},
        ]
    )
    monkeypatch.setattr(mutations, "fetch_meta_object", lambda *_args, **_kwargs: next(reads))

    class _Graph:
        def __init__(self, _credentials) -> None:
            pass

        def post(self, path, data):
            assert path == "/campaign_1"
            assert data == {"name": "After"}
            return {"success": True}

    monkeypatch.setattr(mutations, "MetaGraphClient", _Graph)
    preview = PreviewRecord(
        provider="meta_ads",
        account_id="act_1",
        object_type="campaign",
        object_id="campaign_1",
        operation="change_name",
        action="update",
        payload={"id": "campaign_1", "name": "After"},
    )

    result = mutations.commit_meta_app_review_preview(
        MetaAccountCredentials("1", "app", "secret", "token"),
        preview,
    ).model_dump()

    assert result["status"] == "committed"
    assert result["diff"]["before"]["name"] == "Before"
    assert result["diff"]["after"]["name"] == "After"
    assert result["provider_response"]["verified_by_reread"] is True
    assert result["provider_response"]["real_data"] is True

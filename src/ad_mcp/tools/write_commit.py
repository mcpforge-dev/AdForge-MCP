from __future__ import annotations

from ad_mcp.core.audit_logger import AuditLogger
from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.policy import PolicyManager
from ad_mcp.core.preview_manager import PreviewManager
from ad_mcp.settings import Settings


def build_write_commit_tools(
    registry: CapabilityRegistry,
    preview_manager: PreviewManager,
    audit_logger: AuditLogger,
    policy_manager: PolicyManager,
    settings: Settings | None = None,
) -> dict[str, callable]:
    settings = settings or Settings()
    def commit_preview(preview_token: str) -> dict:
        preview = preview_manager.get(preview_token)
        policy_manager.validate_account_access(bool(registry.get_provider(preview.provider).get_account_config(preview.account_id)))
        if policy_manager.preview_only_enabled:
            result = {
                "status": "blocked",
                "provider": preview.provider,
                "account_id": preview.account_id,
                "object_type": preview.object_type,
                "action": preview.action,
                "preview_token": preview.token,
                "diff": preview.diff,
                "risk_flags": preview.risk_flags,
                "provider_payload": preview.provider_payload,
                "provider_response": {
                    "mode": "preview_only",
                    "message": "Beta MVP is preview-only. No external mutation was executed.",
                },
            }
            audit_logger.log("commit_preview_blocked", result)
            return result
        policy_manager.ensure_preview_only()
        preview = preview_manager.consume(preview_token)
        response = registry.get_provider(preview.provider).commit_preview(preview)
        result = response.model_dump()
        audit_logger.log("commit_preview", result)
        return result

    def commit_meta_app_review_preview(preview_token: str, confirmation: str) -> dict:
        preview = preview_manager.get(preview_token)
        blocked = {
            "status": "blocked",
            "provider": preview.provider,
            "account_id": preview.account_id,
            "object_type": preview.object_type,
            "action": preview.action,
            "provider_response": {
                "mode": "preview_only",
                "message": "Meta App Review commit was blocked by server policy.",
            },
        }
        allowed_objects = {
            item.strip() for item in settings.meta_app_review_allowed_object_ids.split(",") if item.strip()
        }
        allowed_actions = {
            item.strip() for item in settings.meta_app_review_allowed_actions.split(",") if item.strip()
        }
        policy_allows = (
            settings.env.strip().lower() == "staging"
            and settings.preview_only
            and settings.meta_app_review_commit_enabled
            and preview.provider == "meta_ads"
            and preview.object_type == "campaign"
            and preview.account_id == settings.meta_app_review_allowed_account_id.strip()
            and str(preview.object_id or "") in allowed_objects
            and str(preview.operation or "") in allowed_actions
        )
        if not policy_allows or confirmation != f"CONFIRM {preview.token}":
            audit_logger.log("meta_app_review_commit_blocked", blocked)
            return blocked
        provider = registry.get_provider("meta_ads")
        policy_manager.validate_account_access(bool(provider.get_account_config(preview.account_id)))
        preview = preview_manager.consume(preview_token)
        response = provider.commit_app_review_preview(preview)
        result = response.model_dump()
        audit_logger.log("meta_app_review_commit", result)
        return result

    return {
        "commit_preview": commit_preview,
        "commit_meta_app_review_preview": commit_meta_app_review_preview,
    }

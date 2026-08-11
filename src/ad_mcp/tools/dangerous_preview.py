from __future__ import annotations

import re
from typing import Any

from ad_mcp.core.audit_logger import AuditLogger
from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.connection_store import load_runtime_provider_configs
from ad_mcp.core.models import ObjectMutationResponse
from ad_mcp.core.policy import PolicyManager
from ad_mcp.core.preview_manager import PreviewManager
from ad_mcp.providers.meta_ads.auth import normalize_meta_account_id
from ad_mcp.providers.meta_ads.mutations import build_meta_write_request
from ad_mcp.settings import Settings
from ad_mcp.tools._shared import validate_provider_account

PREVIEW_ONLY_REASON = "Beta MVP работает в preview-only mode. Реальные изменения отключены."
PREVIEW_ONLY_NOTE = "Реальное изменение не выполнено."


def _refresh_runtime_connections(registry: CapabilityRegistry, settings: Settings) -> None:
    provider_configs, _ = load_runtime_provider_configs(settings)
    for provider, config in provider_configs.items():
        if provider in registry.providers:
            registry.get_provider(provider).config = config


def _ad_group_object_type(platform: str) -> str:
    if platform == "meta_ads":
        return "adset"
    if platform == "tiktok_ads":
        return "adgroup"
    return "ad_group"


def _object_name(current: dict[str, Any]) -> str | None:
    return current.get("name") or current.get("campaign_name") or current.get("adset_name") or current.get("ad_name")


def _object_status(current: dict[str, Any]) -> Any:
    return current.get("effective_status") or current.get("status") or current.get("configured_status")


def _budget_value(current: dict[str, Any]) -> Any:
    for key in ("daily_budget", "lifetime_budget", "budget_remaining", "daily_budget_micros"):
        if current.get(key) not in (None, ""):
            return current.get(key)
    return None


def _currency(account_config: dict[str, Any], current: dict[str, Any]) -> str | None:
    return current.get("currency") or account_config.get("currency") or account_config.get("currency_code")


def _redact_error(message: str, account_config: dict[str, Any] | None = None) -> str:
    redacted = str(message or "")
    if account_config:
        candidates = [str(value) for value in account_config.values() if isinstance(value, str) and len(value) >= 8]
        credentials = account_config.get("credentials")
        if isinstance(credentials, dict):
            candidates.extend(str(value) for value in credentials.values() if isinstance(value, str) and len(value) >= 8)
        for candidate in candidates:
            redacted = redacted.replace(candidate, "[redacted]")
    return re.sub(r"(?i)(access_token|refresh_token|client_secret|app_secret|developer_token)=([^&\s]+)", r"\1=[redacted]", redacted)


def _format_money(value: Any, currency: str | None, period: str | None = None) -> str:
    if value in (None, ""):
        return "unknown"
    suffix = f" {currency}" if currency else ""
    if period:
        suffix += f"/{period}"
    return f"{value}{suffix}"


def _risk_for_status_change(current_status: Any, requested_status: str) -> str:
    if str(current_status or "").upper() == requested_status.upper():
        return "low"
    if requested_status.upper() in {"ACTIVE", "ENABLED"}:
        return "medium"
    return "low"


def _risk_for_budget_change(current_value: Any, requested_value: Any, max_delta_percent: int) -> str:
    try:
        current = float(current_value)
        requested = float(requested_value)
    except (TypeError, ValueError):
        return "medium"
    if current <= 0:
        return "medium"
    delta = abs((requested - current) / current * 100)
    if delta > max_delta_percent:
        return "high"
    if delta >= 10:
        return "medium"
    return "low"


def _not_available(
    *,
    platform: str,
    account_id: str,
    object_type: str,
    object_id: str,
    action: str,
    message: str,
) -> dict[str, Any]:
    return {
        "status": "error",
        "mode": "preview_only",
        "will_apply": False,
        "platform": platform,
        "account_id": account_id,
        "object_type": object_type,
        "object_id": object_id,
        "action": action,
        "reason": PREVIEW_ONLY_REASON,
        "note": PREVIEW_ONLY_NOTE,
        "error": message,
    }


def build_dangerous_preview_tools(
    registry: CapabilityRegistry,
    preview_manager: PreviewManager,
    audit_logger: AuditLogger,
    policy_manager: PolicyManager,
    settings: Settings,
) -> dict[str, callable]:
    def _fetch_current(platform: str, account_id: str, object_type: str, object_id: str, action: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        _refresh_runtime_connections(registry, settings)
        account_config = validate_provider_account(registry, policy_manager, platform, account_id)
        provider_client = registry.get_provider(platform)
        try:
            payload = provider_client.get_account_object(account_id, object_type, object_id)
        except Exception as exc:  # noqa: BLE001
            return None, _not_available(
                platform=platform,
                account_id=account_id,
                object_type=object_type,
                object_id=object_id,
                action=action,
                message=_redact_error(str(exc), account_config),
            )
        if payload.get("status") == "unsupported":
            return None, _not_available(
                platform=platform,
                account_id=account_id,
                object_type=object_type,
                object_id=object_id,
                action=action,
                message=payload.get("message", "Current object state is not available for this provider."),
            )
        current = payload.get("data")
        if not isinstance(current, dict):
            return None, _not_available(
                platform=platform,
                account_id=account_id,
                object_type=object_type,
                object_id=object_id,
                action=action,
                message="Current object state could not be loaded. Preview was not created.",
            )
        return {"account_config": account_config, "current": current}, None

    def _provider_payload_status(platform: str, object_type: str, object_id: str, requested_status: str) -> dict[str, Any]:
        if platform == "google_ads":
            return {"id": object_id, "status": requested_status}
        return {"id": object_id, "status": requested_status}

    def _record_preview(
        *,
        platform: str,
        account_id: str,
        object_type: str,
        object_id: str,
        action: str,
        mutation_payload: dict[str, Any],
        current: dict[str, Any],
        current_value: Any,
        requested_value: Any,
        expected_result: str,
        risk_level: str,
    ) -> dict[str, Any]:
        policy_manager.ensure_preview_only()
        preview = registry.get_provider(platform).preview_mutation(
            action="update",
            account_id=account_id,
            object_type=object_type,
            payload=mutation_payload,
        )
        preview.operation = action
        preview.object_id = object_id
        preview.current_snapshot = dict(current)
        is_meta_campaign_rename = (
            platform == "meta_ads"
            and object_type == "campaign"
            and action == "change_name"
        )
        if is_meta_campaign_rename:
            request = build_meta_write_request(
                account_id,
                "update",
                "campaign",
                {"name": requested_value},
                object_id,
            )
            preview.payload = dict(request["body"])
            preview.provider_payload = request
            preview.diff = {"before": dict(current), "requested": dict(request["body"])}
        preview_manager.create(preview)
        mutation_response = ObjectMutationResponse(
            status="preview",
            provider=platform,
            account_id=account_id,
            object_type=object_type,
            action="update",
            preview_token=preview.token,
            diff=preview.diff,
            risk_flags=preview.risk_flags,
            provider_payload=preview.provider_payload,
        ).model_dump()
        allowed_objects = {
            item.strip() for item in settings.meta_app_review_allowed_object_ids.split(",") if item.strip()
        }
        allowed_actions = {
            item.strip() for item in settings.meta_app_review_allowed_actions.split(",") if item.strip()
        }
        review_commit_available = (
            settings.env.strip().lower() == "staging"
            and settings.preview_only
            and settings.meta_app_review_commit_enabled
            and platform == "meta_ads"
            and account_id == settings.meta_app_review_allowed_account_id.strip()
            and object_id in allowed_objects
            and action in allowed_actions
            and object_type == "campaign"
        )
        confirmed_accounts = {
            normalize_meta_account_id(item)
            for item in settings.meta_confirmed_write_allowed_account_ids.split(",")
            if item.strip()
        }
        confirmed_objects = {
            item.strip()
            for item in settings.meta_confirmed_write_allowed_object_ids.split(",")
            if item.strip()
        }
        confirmed_actions = {
            item.strip()
            for item in settings.meta_confirmed_write_allowed_actions.split(",")
            if item.strip()
        }
        confirmed_write_available = (
            is_meta_campaign_rename
            and settings.env.strip().lower() in {"staging", "beta", "production"}
            and settings.preview_only
            and settings.meta_ads_management_oauth_enabled
            and settings.meta_confirmed_write_enabled
            and normalize_meta_account_id(account_id) in confirmed_accounts
            and object_id in confirmed_objects
            and action in confirmed_actions
        )
        if confirmed_write_available:
            mode = "preview_confirm"
            reason = (
                "Preview prepared. This allowlisted Meta App Review change is available "
                "only after the user's separate explicit confirmation."
            )
            note = "No change has been made yet. Use commit_meta_confirmed_write after confirmation."
            explicit_confirmation = f"CONFIRM META WRITE {preview.token}"
            commit_tool = "commit_meta_confirmed_write"
        elif review_commit_available:
            mode = "preview_confirm"
            reason = "Preview prepared. The staging App Review change requires separate explicit confirmation."
            note = "No change has been made yet. Use commit_meta_app_review_preview after confirmation."
            explicit_confirmation = f"CONFIRM {preview.token}"
            commit_tool = "commit_meta_app_review_preview"
        else:
            mode = "preview_only"
            reason = PREVIEW_ONLY_REASON
            note = PREVIEW_ONLY_NOTE
            explicit_confirmation = None
            commit_tool = None
        commit_available = confirmed_write_available or review_commit_available
        response = {
            "status": "preview",
            "mode": mode,
            "will_apply": False,
            "platform": platform,
            "account_id": account_id,
            "object_type": object_type,
            "object_id": object_id,
            "object_name": _object_name(current),
            "action": action,
            "current_value": current_value,
            "requested_value": requested_value,
            "expected_result": expected_result,
            "risk_level": risk_level,
            "reason": reason,
            "note": note,
            "preview_token": preview.token,
            "provider_payload": mutation_response["provider_payload"],
            "provider_request": mutation_response["provider_payload"],
            "diff": mutation_response["diff"],
            "risk_flags": sorted(set(mutation_response["risk_flags"] + ([risk_level] if risk_level == "high" else []))),
            "app_review_commit_available": commit_available,
            "confirmed_write_available": confirmed_write_available,
            "commit_available_after_confirmation": commit_available,
            "commit_tool": commit_tool,
            "required_oauth_permission": "ads_management" if is_meta_campaign_rename else None,
            "explicit_confirmation": explicit_confirmation,
        }
        audit_logger.log(f"preview_only_{action}", response)
        return response

    def _status_preview(platform: str, account_id: str, object_type: str, object_id: str, action: str, requested_status: str) -> dict:
        try:
            loaded, error = _fetch_current(platform, account_id, object_type, object_id, action)
        except Exception as exc:  # noqa: BLE001 - MCP tools should return structured errors.
            return _not_available(platform=platform, account_id=account_id, object_type=object_type, object_id=object_id, action=action, message=_redact_error(str(exc)))
        if error:
            return error
        if loaded is None:
            return _not_available(
                platform=platform,
                account_id=account_id,
                object_type=object_type,
                object_id=object_id,
                action=action,
                message="Current object state could not be loaded. Preview was not created.",
            )
        current = loaded["current"]
        current_status = _object_status(current)
        mutation_payload = _provider_payload_status(platform, object_type, object_id, requested_status)
        risk_level = _risk_for_status_change(current_status, requested_status)
        return _record_preview(
            platform=platform,
            account_id=account_id,
            object_type=object_type,
            object_id=object_id,
            action=action,
            mutation_payload=mutation_payload,
            current=current,
            current_value=current_status,
            requested_value=requested_status,
            expected_result=f"{object_type} status would change from {current_status} to {requested_status}.",
            risk_level=risk_level,
        )

    def _budget_preview(
        platform: str,
        account_id: str,
        object_type: str,
        object_id: str,
        action: str,
        daily_budget: float | None = None,
        lifetime_budget: float | None = None,
    ) -> dict:
        requested_budget = daily_budget if daily_budget is not None else lifetime_budget
        budget_field = "daily_budget" if daily_budget is not None else "lifetime_budget"
        if requested_budget is None:
            return _not_available(
                platform=platform,
                account_id=account_id,
                object_type=object_type,
                object_id=object_id,
                action=action,
                message="daily_budget or lifetime_budget is required for budget preview.",
            )
        try:
            loaded, error = _fetch_current(platform, account_id, object_type, object_id, action)
        except Exception as exc:  # noqa: BLE001
            return _not_available(platform=platform, account_id=account_id, object_type=object_type, object_id=object_id, action=action, message=_redact_error(str(exc)))
        if error:
            return error
        if loaded is None:
            return _not_available(
                platform=platform,
                account_id=account_id,
                object_type=object_type,
                object_id=object_id,
                action=action,
                message="Current object state could not be loaded. Preview was not created.",
            )
        account_config = loaded["account_config"]
        current = loaded["current"]
        current_budget = current.get(budget_field)
        if current_budget in (None, ""):
            current_budget = _budget_value(current)
        currency = _currency(account_config, current)
        mutation_payload = {"id": object_id, budget_field: requested_budget}
        risk_level = _risk_for_budget_change(current_budget, requested_budget, policy_manager.policy.max_budget_delta_percent)
        return _record_preview(
            platform=platform,
            account_id=account_id,
            object_type=object_type,
            object_id=object_id,
            action=action,
            mutation_payload=mutation_payload,
            current=current,
            current_value=_format_money(current_budget, currency, "day" if budget_field == "daily_budget" else None),
            requested_value=_format_money(requested_budget, currency, "day" if budget_field == "daily_budget" else None),
            expected_result=f"{object_type} budget would change from {_format_money(current_budget, currency)} to {_format_money(requested_budget, currency)}.",
            risk_level=risk_level,
        )

    def preview_pause_campaign(platform: str, account_id: str, campaign_id: str) -> dict:
        return _status_preview(platform, account_id, "campaign", campaign_id, "pause_campaign", "PAUSED")

    def preview_resume_campaign(platform: str, account_id: str, campaign_id: str) -> dict:
        return _status_preview(platform, account_id, "campaign", campaign_id, "resume_campaign", "ACTIVE")

    def preview_change_campaign_budget(
        platform: str,
        account_id: str,
        campaign_id: str,
        daily_budget: float | None = None,
        lifetime_budget: float | None = None,
    ) -> dict:
        return _budget_preview(platform, account_id, "campaign", campaign_id, "change_budget", daily_budget, lifetime_budget)

    def preview_change_campaign_name(platform: str, account_id: str, campaign_id: str, new_name: str) -> dict:
        """Preview a campaign rename; allowlisted Meta reviews can be committed after explicit confirmation."""
        try:
            loaded, error = _fetch_current(platform, account_id, "campaign", campaign_id, "change_name")
        except Exception as exc:  # noqa: BLE001
            return _not_available(platform=platform, account_id=account_id, object_type="campaign", object_id=campaign_id, action="change_name", message=_redact_error(str(exc)))
        if error:
            return error
        if loaded is None:
            return _not_available(
                platform=platform,
                account_id=account_id,
                object_type="campaign",
                object_id=campaign_id,
                action="change_name",
                message="Current campaign state could not be loaded. Preview was not created.",
            )
        current = loaded["current"]
        current_name = _object_name(current)
        return _record_preview(
            platform=platform,
            account_id=account_id,
            object_type="campaign",
            object_id=campaign_id,
            action="change_name",
            mutation_payload={"name": new_name} if platform == "meta_ads" else {"id": campaign_id, "name": new_name},
            current=current,
            current_value=current_name,
            requested_value=new_name,
            expected_result=f"Campaign name would change from {current_name} to {new_name}.",
            risk_level="low",
        )

    def preview_pause_adset_or_group(platform: str, account_id: str, adset_or_group_id: str) -> dict:
        object_type = _ad_group_object_type(platform)
        return _status_preview(platform, account_id, object_type, adset_or_group_id, "pause_adset_or_group", "PAUSED")

    def preview_resume_adset_or_group(platform: str, account_id: str, adset_or_group_id: str) -> dict:
        object_type = _ad_group_object_type(platform)
        return _status_preview(platform, account_id, object_type, adset_or_group_id, "resume_adset_or_group", "ACTIVE")

    def preview_change_adset_or_group_budget(
        platform: str,
        account_id: str,
        adset_or_group_id: str,
        daily_budget: float | None = None,
        lifetime_budget: float | None = None,
    ) -> dict:
        object_type = _ad_group_object_type(platform)
        return _budget_preview(platform, account_id, object_type, adset_or_group_id, "change_adset_or_group_budget", daily_budget, lifetime_budget)

    def preview_pause_ad(platform: str, account_id: str, ad_id: str) -> dict:
        return _status_preview(platform, account_id, "ad", ad_id, "pause_ad", "PAUSED")

    def preview_resume_ad(platform: str, account_id: str, ad_id: str) -> dict:
        return _status_preview(platform, account_id, "ad", ad_id, "resume_ad", "ACTIVE")

    return {
        "preview_pause_campaign": preview_pause_campaign,
        "preview_resume_campaign": preview_resume_campaign,
        "preview_change_campaign_budget": preview_change_campaign_budget,
        "preview_change_campaign_name": preview_change_campaign_name,
        "preview_pause_adset_or_group": preview_pause_adset_or_group,
        "preview_resume_adset_or_group": preview_resume_adset_or_group,
        "preview_change_adset_or_group_budget": preview_change_adset_or_group_budget,
        "preview_pause_ad": preview_pause_ad,
        "preview_resume_ad": preview_resume_ad,
    }

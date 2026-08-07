from __future__ import annotations

from typing import Any

from ad_mcp.core.audit_logger import AuditLogger
from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.errors import PolicyViolationError
from ad_mcp.core.models import ObjectMutationResponse
from ad_mcp.core.policy import PolicyManager
from ad_mcp.core.preview_manager import PreviewManager
from ad_mcp.providers.meta_ads.auth import normalize_meta_account_id
from ad_mcp.providers.meta_ads.mutations import build_meta_write_request
from ad_mcp.settings import Settings
from ad_mcp.tools._shared import validate_provider_account


def _clean(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None and value != ""}


def _validate_budget_fields(payload: dict[str, Any]) -> None:
    for key in ("daily_budget", "lifetime_budget", "spend_cap", "bid_amount"):
        value = payload.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"{key} must be a non-negative integer in Meta account minor currency units.")


def _validate_status(payload: dict[str, Any], *, create: bool) -> None:
    status = str(payload.get("status") or ("PAUSED" if create else "")).upper()
    if status and status not in {"PAUSED", "ACTIVE"}:
        raise ValueError("Meta write status must be PAUSED or ACTIVE.")
    if create and status != "PAUSED":
        raise ValueError("New Meta campaigns, ad sets and ads can only be created as PAUSED.")


def _validate_budget_delta(
    current: dict[str, Any],
    requested: dict[str, Any],
    max_delta_percent: int,
) -> None:
    for key in ("daily_budget", "lifetime_budget", "spend_cap", "bid_amount"):
        if key not in requested or key not in current:
            continue
        try:
            before = int(current[key])
            after = int(requested[key])
        except (TypeError, ValueError):
            continue
        if before <= 0:
            continue
        delta_percent = abs(after - before) / before * 100
        if delta_percent > max_delta_percent:
            raise PolicyViolationError(
                f"{key} change of {delta_percent:.1f}% exceeds "
                f"max_budget_delta_percent={max_delta_percent}."
            )


def _required(payload: dict[str, Any], fields: tuple[str, ...]) -> None:
    missing = [field for field in fields if payload.get(field) in (None, "", {})]
    if missing:
        raise ValueError(f"Missing required Meta write fields: {', '.join(missing)}.")


def _operation_name(action: str, object_type: str, body: dict[str, Any]) -> str:
    if action == "update" and object_type == "campaign":
        if set(body) == {"name"}:
            return "change_name"
        if set(body) == {"status"}:
            return "pause_campaign" if str(body["status"]).upper() == "PAUSED" else "resume_campaign"
    return f"{action}_{object_type}"


def build_meta_write_tools(
    registry: CapabilityRegistry,
    preview_manager: PreviewManager,
    audit_logger: AuditLogger,
    policy_manager: PolicyManager,
    settings: Settings,
) -> dict[str, callable]:
    def _account_allowed(account_id: str) -> bool:
        allowed = {
            normalize_meta_account_id(item)
            for item in settings.meta_confirmed_write_allowed_account_ids.split(",")
            if item.strip()
        }
        return normalize_meta_account_id(account_id) in allowed

    def _operation_allowed(operation: str) -> bool:
        allowed = {
            item.strip()
            for item in settings.meta_confirmed_write_allowed_actions.split(",")
            if item.strip()
        }
        return operation in allowed

    def _object_allowed(action: str, object_id: str | None) -> bool:
        if action == "create":
            return True
        allowed = {
            item.strip()
            for item in settings.meta_confirmed_write_allowed_object_ids.split(",")
            if item.strip()
        }
        return bool(object_id and object_id in allowed)

    def _preview(
        action: str,
        account_id: str,
        object_type: str,
        payload: dict[str, Any],
        *,
        object_id: str | None = None,
    ) -> dict[str, Any]:
        policy_manager.ensure_preview_only()
        validate_provider_account(registry, policy_manager, "meta_ads", account_id)
        provider = registry.get_provider("meta_ads")
        cleaned = _clean(payload)
        _validate_budget_fields(cleaned)
        _validate_status(cleaned, create=action == "create")
        current: dict[str, Any] = {}
        if action == "update":
            if not object_id:
                raise ValueError("object_id is required for Meta update preview.")
            if not cleaned:
                raise ValueError("At least one field is required for Meta update preview.")
            current_payload = provider.get_account_object(account_id, object_type, object_id)
            current = current_payload.get("data") if isinstance(current_payload.get("data"), dict) else {}
            if not current:
                raise ValueError("Current Meta object could not be read; update preview was not created.")
            _validate_budget_delta(
                current,
                cleaned,
                policy_manager.policy.max_budget_delta_percent,
            )
        request = build_meta_write_request(account_id, action, object_type, cleaned, object_id)
        operation = _operation_name(action, object_type, request["body"])
        risk_flags: list[str] = []
        if action == "create":
            risk_flags.append("creates_paused_object")
        if str(request["body"].get("status") or "").upper() == "ACTIVE":
            risk_flags.append("activates_delivery")
        if any(key in request["body"] for key in ("daily_budget", "lifetime_budget", "spend_cap", "bid_amount")):
            risk_flags.append("changes_money_or_bid")
        if any(key in request["body"] for key in ("targeting", "promoted_object", "creative")):
            risk_flags.append("changes_delivery_configuration")
        preview = provider.preview_mutation(
            action=action,
            account_id=account_id,
            object_type=object_type,
            payload=cleaned,
        )
        preview.operation = operation
        preview.object_id = object_id
        preview.current_snapshot = current
        preview.provider_payload = request
        preview.diff = {"before": current, "requested": request["body"]}
        preview.risk_flags = sorted(set(preview.risk_flags + risk_flags))
        preview_manager.create(preview)
        commit_available = (
            settings.preview_only
            and settings.meta_ads_management_oauth_enabled
            and settings.meta_confirmed_write_enabled
            and _account_allowed(account_id)
            and _object_allowed(action, object_id)
            and _operation_allowed(operation)
        )
        result = ObjectMutationResponse(
            status="preview",
            provider="meta_ads",
            account_id=account_id,
            object_type=object_type,
            action=action,
            preview_token=preview.token,
            diff=preview.diff,
            risk_flags=preview.risk_flags,
            provider_payload=request,
        ).model_dump()
        result.update(
            {
                "mode": "preview_confirm",
                "will_apply": False,
                "operation": operation,
                "confirmed_write_available": commit_available,
                "required_oauth_permission": "ads_management",
                "explicit_confirmation": f"CONFIRM META WRITE {preview.token}" if commit_available else None,
                "expires_in_seconds": preview.expires_in_seconds,
            }
        )
        audit_logger.log("meta_write_preview", result)
        return result

    def preview_meta_create_campaign(
        account_id: str,
        name: str,
        objective: str,
        special_ad_categories: list[str] | None = None,
        daily_budget: int | None = None,
        lifetime_budget: int | None = None,
        bid_strategy: str | None = None,
        buying_type: str = "AUCTION",
        start_time: str | None = None,
        stop_time: str | None = None,
        status: str = "PAUSED",
    ) -> dict:
        payload = {
            "name": name,
            "objective": objective,
            "special_ad_categories": special_ad_categories or [],
            "daily_budget": daily_budget,
            "lifetime_budget": lifetime_budget,
            "bid_strategy": bid_strategy,
            "buying_type": buying_type,
            "start_time": start_time,
            "stop_time": stop_time,
            "status": status,
        }
        _required(payload, ("name", "objective"))
        return _preview("create", account_id, "campaign", payload)

    def preview_meta_create_adset(
        account_id: str,
        campaign_id: str,
        name: str,
        billing_event: str,
        optimization_goal: str,
        targeting: dict,
        daily_budget: int | None = None,
        lifetime_budget: int | None = None,
        bid_strategy: str | None = None,
        bid_amount: int | None = None,
        promoted_object: dict | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
        status: str = "PAUSED",
    ) -> dict:
        payload = {
            "campaign_id": campaign_id,
            "name": name,
            "billing_event": billing_event,
            "optimization_goal": optimization_goal,
            "targeting": targeting,
            "daily_budget": daily_budget,
            "lifetime_budget": lifetime_budget,
            "bid_strategy": bid_strategy,
            "bid_amount": bid_amount,
            "promoted_object": promoted_object,
            "start_time": start_time,
            "end_time": end_time,
            "status": status,
        }
        _required(payload, ("campaign_id", "name", "billing_event", "optimization_goal", "targeting"))
        return _preview("create", account_id, "adset", payload)

    def preview_meta_create_creative(
        account_id: str,
        name: str,
        object_story_spec: dict | None = None,
        asset_feed_spec: dict | None = None,
        object_story_id: str | None = None,
        url_tags: str | None = None,
    ) -> dict:
        if not any((object_story_spec, asset_feed_spec, object_story_id)):
            raise ValueError("Creative requires object_story_spec, asset_feed_spec or object_story_id.")
        return _preview(
            "create",
            account_id,
            "creative",
            {
                "name": name,
                "object_story_spec": object_story_spec,
                "asset_feed_spec": asset_feed_spec,
                "object_story_id": object_story_id,
                "url_tags": url_tags,
            },
        )

    def preview_meta_create_ad(
        account_id: str,
        adset_id: str,
        name: str,
        creative_id: str,
        tracking_specs: list[dict] | None = None,
        status: str = "PAUSED",
    ) -> dict:
        payload = {
            "adset_id": adset_id,
            "name": name,
            "creative_id": creative_id,
            "tracking_specs": tracking_specs,
            "status": status,
        }
        _required(payload, ("adset_id", "name", "creative_id"))
        return _preview("create", account_id, "ad", payload)

    def preview_meta_update_campaign(
        account_id: str,
        campaign_id: str,
        name: str | None = None,
        status: str | None = None,
        daily_budget: int | None = None,
        lifetime_budget: int | None = None,
        bid_strategy: str | None = None,
        spend_cap: int | None = None,
    ) -> dict:
        return _preview(
            "update",
            account_id,
            "campaign",
            {
                "name": name,
                "status": status,
                "daily_budget": daily_budget,
                "lifetime_budget": lifetime_budget,
                "bid_strategy": bid_strategy,
                "spend_cap": spend_cap,
            },
            object_id=campaign_id,
        )

    def preview_meta_update_adset(
        account_id: str,
        adset_id: str,
        name: str | None = None,
        status: str | None = None,
        daily_budget: int | None = None,
        lifetime_budget: int | None = None,
        bid_strategy: str | None = None,
        bid_amount: int | None = None,
        targeting: dict | None = None,
        promoted_object: dict | None = None,
        end_time: str | None = None,
    ) -> dict:
        return _preview(
            "update",
            account_id,
            "adset",
            {
                "name": name,
                "status": status,
                "daily_budget": daily_budget,
                "lifetime_budget": lifetime_budget,
                "bid_strategy": bid_strategy,
                "bid_amount": bid_amount,
                "targeting": targeting,
                "promoted_object": promoted_object,
                "end_time": end_time,
            },
            object_id=adset_id,
        )

    def preview_meta_update_ad(
        account_id: str,
        ad_id: str,
        name: str | None = None,
        status: str | None = None,
        creative_id: str | None = None,
        tracking_specs: list[dict] | None = None,
    ) -> dict:
        return _preview(
            "update",
            account_id,
            "ad",
            {
                "name": name,
                "status": status,
                "creative_id": creative_id,
                "tracking_specs": tracking_specs,
            },
            object_id=ad_id,
        )

    return {
        "preview_meta_create_campaign": preview_meta_create_campaign,
        "preview_meta_create_adset": preview_meta_create_adset,
        "preview_meta_create_creative": preview_meta_create_creative,
        "preview_meta_create_ad": preview_meta_create_ad,
        "preview_meta_update_campaign": preview_meta_update_campaign,
        "preview_meta_update_adset": preview_meta_update_adset,
        "preview_meta_update_ad": preview_meta_update_ad,
    }

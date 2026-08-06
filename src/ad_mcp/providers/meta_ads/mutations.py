from __future__ import annotations

from typing import Any

from ad_mcp.core.models import ObjectMutationResponse, PreviewRecord
from ad_mcp.providers.meta_ads.account_read import fetch_meta_object
from ad_mcp.providers.meta_ads.auth import (
    MetaAccountCredentials,
    normalize_meta_account_id,
)
from ad_mcp.providers.meta_ads.graph_read import MetaGraphClient
from ad_mcp.providers.meta_ads.provenance import live_meta_payload

ALLOWED_REVIEW_OPERATIONS = {"change_name", "pause_campaign", "resume_campaign"}
META_CREATE_FIELDS: dict[str, set[str]] = {
    "campaign": {
        "name",
        "objective",
        "status",
        "special_ad_categories",
        "daily_budget",
        "lifetime_budget",
        "bid_strategy",
        "buying_type",
        "start_time",
        "stop_time",
    },
    "adset": {
        "name",
        "campaign_id",
        "status",
        "billing_event",
        "optimization_goal",
        "bid_strategy",
        "bid_amount",
        "daily_budget",
        "lifetime_budget",
        "targeting",
        "promoted_object",
        "start_time",
        "end_time",
    },
    "creative": {"name", "object_story_spec", "asset_feed_spec", "object_story_id", "url_tags"},
    "ad": {"name", "adset_id", "creative_id", "status", "tracking_specs"},
}
META_UPDATE_FIELDS: dict[str, set[str]] = {
    "campaign": {"name", "status", "daily_budget", "lifetime_budget", "bid_strategy", "spend_cap", "start_time", "stop_time"},
    "adset": {
        "name",
        "status",
        "daily_budget",
        "lifetime_budget",
        "bid_strategy",
        "bid_amount",
        "targeting",
        "promoted_object",
        "start_time",
        "end_time",
    },
    "ad": {"name", "status", "creative_id", "tracking_specs"},
}
CREATE_ENDPOINTS = {
    "campaign": "campaigns",
    "adset": "adsets",
    "creative": "adcreatives",
    "ad": "ads",
}


def _clean_payload(payload: dict[str, Any], allowed_fields: set[str]) -> dict[str, Any]:
    return {
        key: value
        for key, value in payload.items()
        if key in allowed_fields and value is not None and value != ""
    }


def build_meta_write_request(
    account_id: str,
    action: str,
    object_type: str,
    payload: dict[str, Any],
    object_id: str | None = None,
) -> dict[str, Any]:
    if action == "create":
        if object_type not in META_CREATE_FIELDS:
            raise ValueError(f"Unsupported Meta create object_type='{object_type}'.")
        body = _clean_payload(payload, META_CREATE_FIELDS[object_type])
        if object_type in {"campaign", "adset", "ad"}:
            body["status"] = "PAUSED"
        endpoint = f"/act_{normalize_meta_account_id(account_id)}/{CREATE_ENDPOINTS[object_type]}"
    elif action == "update":
        if object_type not in META_UPDATE_FIELDS:
            raise ValueError(f"Unsupported Meta update object_type='{object_type}'.")
        if not object_id:
            raise ValueError("Meta update preview is missing object_id.")
        body = _clean_payload(payload, META_UPDATE_FIELDS[object_type])
        endpoint = f"/{object_id}"
    else:
        raise ValueError(f"Unsupported Meta write action='{action}'.")

    creative_id = body.pop("creative_id", None)
    if creative_id:
        body["creative"] = {"creative_id": str(creative_id)}
    if not body:
        raise ValueError("Meta write request contains no supported fields.")
    return {
        "http_method": "POST",
        "endpoint": endpoint,
        "body": body,
    }


def _verification_fields(object_type: str, requested: dict[str, Any]) -> list[str] | None:
    base_fields = {
        "campaign": {"id", "name", "status", "effective_status"},
        "adset": {"id", "name", "campaign_id", "status", "effective_status"},
        "ad": {"id", "name", "campaign_id", "adset_id", "status", "effective_status", "configured_status"},
        "creative": {"id", "name", "status"},
    }
    readable = {
        "campaign": {
            "objective",
            "buying_type",
            "special_ad_categories",
            "daily_budget",
            "lifetime_budget",
            "bid_strategy",
            "spend_cap",
            "start_time",
            "stop_time",
        },
        "adset": {
            "billing_event",
            "optimization_goal",
            "daily_budget",
            "lifetime_budget",
            "bid_strategy",
            "bid_amount",
            "targeting",
            "promoted_object",
            "start_time",
            "end_time",
        },
        "ad": {"creative", "tracking_specs"},
        "creative": {"object_story_id", "object_story_spec", "asset_feed_spec", "url_tags"},
    }
    fields = set(base_fields.get(object_type, {"id"}))
    fields.update(readable.get(object_type, set()) & set(requested))
    if "creative" in requested:
        fields.add("creative")
    return sorted(fields)


def _matches(actual: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        return all(key in actual and _matches(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return actual == expected
    return str(actual or "").upper() == str(expected or "").upper()


def _verify_requested(after: dict[str, Any], requested: dict[str, Any]) -> tuple[list[str], list[str]]:
    verified: list[str] = []
    unverified: list[str] = []
    for key, expected in requested.items():
        actual_key = key
        actual_expected = expected
        if key == "creative":
            actual_key = "creative"
        if actual_key in after and _matches(after.get(actual_key), actual_expected):
            verified.append(key)
        else:
            unverified.append(key)
    return verified, unverified


def commit_meta_confirmed_write(
    credentials: MetaAccountCredentials,
    preview: PreviewRecord,
    *,
    require_paused_objects: bool = True,
) -> ObjectMutationResponse:
    request = build_meta_write_request(
        preview.account_id,
        preview.action,
        preview.object_type,
        preview.payload,
        preview.object_id,
    )
    graph = MetaGraphClient(credentials)
    before: dict[str, Any] = {}
    if preview.action == "update":
        before_payload = fetch_meta_object(credentials, preview.object_type, str(preview.object_id or ""))
        before = before_payload.get("data") if isinstance(before_payload.get("data"), dict) else {}
        current_status = str(before.get("effective_status") or before.get("status") or "").upper()
        requested_status = str(request["body"].get("status") or "").upper()
        status_only_activation = requested_status == "ACTIVE" and len(request["body"]) == 1
        pause_operation = requested_status == "PAUSED" and len(request["body"]) == 1
        if require_paused_objects and current_status != "PAUSED" and not pause_operation:
            raise ValueError("Meta object must be paused before confirmed updates are allowed.")
        if status_only_activation and current_status != "PAUSED":
            raise ValueError("Only a paused Meta object can be activated by confirmed write.")

    provider_result = graph.post(request["endpoint"], request["body"])
    if preview.action == "create":
        committed_object_id = str(provider_result.get("id") or "").strip()
        if not committed_object_id:
            raise RuntimeError("Meta did not return an ID for the created object.")
    else:
        committed_object_id = str(preview.object_id or "").strip()
        if provider_result.get("success") is not True:
            raise RuntimeError("Meta did not confirm the requested update.")

    after: dict[str, Any] = {}
    reread_warning: str | None = None
    try:
        after_payload = fetch_meta_object(
            credentials,
            preview.object_type,
            committed_object_id,
            _verification_fields(preview.object_type, request["body"]),
        )
        after = after_payload.get("data") if isinstance(after_payload.get("data"), dict) else {}
    except Exception as exc:  # noqa: BLE001 - write result must remain visible after a successful POST.
        reread_warning = str(exc)[:500]

    verified_fields, unverified_fields = _verify_requested(after, request["body"]) if after else ([], sorted(request["body"]))
    verified_by_reread = bool(after) and not unverified_fields
    return ObjectMutationResponse(
        status="committed",
        provider="meta_ads",
        account_id=preview.account_id,
        object_type=preview.object_type,
        action=preview.action,
        diff={"before": before, "requested": request["body"], "after": after},
        risk_flags=preview.risk_flags,
        provider_payload=request,
        provider_response=live_meta_payload(
            {
                "mode": "confirmed_meta_write",
                "success": True,
                "object_id": committed_object_id,
                "verified_by_reread": verified_by_reread,
                "verified_fields": verified_fields,
                "unverified_fields": unverified_fields,
                "reread_warning": reread_warning,
            },
            source_api="meta_marketing_api",
        ),
    )


def commit_meta_app_review_preview(
    credentials: MetaAccountCredentials,
    preview: PreviewRecord,
) -> ObjectMutationResponse:
    if preview.object_type != "campaign" or preview.operation not in ALLOWED_REVIEW_OPERATIONS:
        raise ValueError("Meta App Review commit only supports allowlisted campaign operations.")
    object_id = str(preview.object_id or "").strip()
    if not object_id:
        raise ValueError("Preview is missing the Meta object ID.")
    requested = {
        key: value
        for key, value in preview.payload.items()
        if key in {"name", "status"} and value not in (None, "")
    }
    if len(requested) != 1:
        raise ValueError("Meta App Review commit requires exactly one low-risk field change.")

    before_payload = fetch_meta_object(credentials, "campaign", object_id)
    before = before_payload.get("data") if isinstance(before_payload.get("data"), dict) else {}
    current_status = str(before.get("effective_status") or before.get("status") or "").upper()
    if preview.operation in {"change_name", "resume_campaign"} and current_status != "PAUSED":
        raise ValueError("The allowlisted Meta test campaign must be paused before this operation can be committed.")

    provider_result = MetaGraphClient(credentials).post(f"/{object_id}", requested)
    if provider_result.get("success") is not True:
        raise RuntimeError("Meta did not confirm the requested mutation.")
    after_payload = fetch_meta_object(credentials, "campaign", object_id)
    after = after_payload.get("data") if isinstance(after_payload.get("data"), dict) else {}
    for key, value in requested.items():
        actual = after.get(key)
        if str(actual or "").upper() != str(value).upper():
            raise RuntimeError(f"Meta mutation was not verified after write for field '{key}'.")

    return ObjectMutationResponse(
        status="committed",
        provider="meta_ads",
        account_id=preview.account_id,
        object_type=preview.object_type,
        action="update",
        diff={"before": before, "requested": requested, "after": after},
        risk_flags=preview.risk_flags,
        provider_payload={"object_id": object_id, "fields": sorted(requested)},
        provider_response=live_meta_payload(
            {
                "mode": "staging_app_review_confirmed_write",
                "success": True,
                "verified_by_reread": True,
                "object_id": object_id,
            },
            source_api="meta_marketing_api",
        ),
    )

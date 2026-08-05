from __future__ import annotations

from ad_mcp.core.models import ObjectMutationResponse, PreviewRecord
from ad_mcp.providers.meta_ads.account_read import fetch_meta_object
from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.graph_read import MetaGraphClient
from ad_mcp.providers.meta_ads.provenance import live_meta_payload

ALLOWED_REVIEW_OPERATIONS = {"change_name", "pause_campaign", "resume_campaign"}


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

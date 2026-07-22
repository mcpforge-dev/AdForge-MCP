from __future__ import annotations

from datetime import date
from typing import Any

from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.policy import PolicyManager
from ad_mcp.providers.google_ads.auth import credentials_from_config as google_credentials
from ad_mcp.providers.google_ads.detailed_reports import GOOGLE_REPORT_SPECS, fetch_google_detailed_report
from ad_mcp.tools._shared import validate_provider_account


META_INSIGHT_FIELDS: dict[str, list[str]] = {
    "actions": [
        "date_start", "date_stop", "campaign_id", "campaign_name", "adset_id", "adset_name",
        "ad_id", "ad_name", "spend", "impressions", "reach", "clicks", "inline_link_clicks",
        "actions", "action_values", "cost_per_action_type",
    ],
    "video": [
        "date_start", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
        "spend", "impressions", "video_play_actions", "video_thruplay_watched_actions",
        "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions",
        "video_p95_watched_actions", "video_p100_watched_actions",
    ],
    "engagement": [
        "date_start", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
        "spend", "impressions", "reach", "actions", "cost_per_action_type",
    ],
}

META_OBJECT_REPORTS = {
    "creatives": "creative",
    "ads": "ad",
    "adsets": "adset",
    "audiences": "audience",
    "saved_audiences": "saved_audience",
    "pixels": "pixel",
    "custom_conversions": "custom_conversion",
    "activities": "activity",
}


def _safe_error(exc: Exception, account_config: dict[str, Any]) -> str:
    message = str(exc)
    for key in ("access_token", "app_secret", "developer_token", "oauth_client_secret", "refresh_token"):
        secret = str(account_config.get(key) or "")
        if secret:
            message = message.replace(secret, "[redacted]")
    return message[:1000]


def _sum_action_list(value: Any) -> float:
    total = 0.0
    for item in value or []:
        try:
            total += float(item.get("value") or 0)
        except (AttributeError, TypeError, ValueError):
            continue
    return total


def _add_action_summary(payload: dict[str, Any], preferred_result_actions: list[str] | None = None) -> dict[str, Any]:
    for row in payload.get("rows", []):
        action_breakdown: dict[str, float] = {}
        for action in row.get("actions") or []:
            action_type = str(action.get("action_type") or "unknown")
            try:
                action_breakdown[action_type] = action_breakdown.get(action_type, 0.0) + float(action.get("value") or 0)
            except (TypeError, ValueError):
                continue
        row["action_breakdown"] = action_breakdown
        row["messaging_conversations_started"] = sum(
            value for key, value in action_breakdown.items() if "messaging_conversation_started" in key
        )
        row["post_engagement"] = sum(
            value for key, value in action_breakdown.items()
            if any(token in key for token in ("post_engagement", "post_reaction", "comment", "share", "save", "follow"))
        )
        row["results_by_action"] = action_breakdown
        if preferred_result_actions:
            row["results"] = sum(action_breakdown.get(action_type, 0.0) for action_type in preferred_result_actions)
            row["result_action_types"] = preferred_result_actions
        for field, output_key in (
            ("video_play_actions", "video_plays"),
            ("video_thruplay_watched_actions", "video_thruplays"),
            ("video_p25_watched_actions", "video_views_25_percent"),
            ("video_p50_watched_actions", "video_views_50_percent"),
            ("video_p75_watched_actions", "video_views_75_percent"),
            ("video_p95_watched_actions", "video_views_95_percent"),
            ("video_p100_watched_actions", "video_views_100_percent"),
        ):
            if field in row:
                row[output_key] = _sum_action_list(row.get(field))
    return payload


def build_ad_detailed_report_tools(
    registry: CapabilityRegistry,
    policy_manager: PolicyManager,
) -> dict[str, callable]:
    def list_detailed_ad_report_types(platform: str) -> dict:
        if platform == "google_ads":
            reports = sorted(GOOGLE_REPORT_SPECS)
        elif platform == "meta_ads":
            reports = sorted([*META_INSIGHT_FIELDS, *META_OBJECT_REPORTS, "billing", "connected_assets"])
        else:
            raise ValueError("Detailed reports currently support google_ads and meta_ads.")
        return {"platform": platform, "reports": reports, "write_enabled": False, "preview_only_compatible": True}

    def get_google_ads_detailed_report(
        account_id: str,
        report_type: str,
        start_date: str | None = None,
        end_date: str | None = None,
        campaign_id: str | None = None,
        ad_group_id: str | None = None,
        limit: int = 500,
    ) -> dict:
        account_config = validate_provider_account(registry, policy_manager, "google_ads", account_id)
        if start_date and end_date:
            date.fromisoformat(start_date)
            date.fromisoformat(end_date)
            policy_manager.validate_report_range(start_date, end_date)
        try:
            return fetch_google_detailed_report(
                google_credentials(account_config), report_type, start_date, end_date,
                campaign_id=campaign_id, ad_group_id=ad_group_id, limit=limit,
            )
        except Exception as exc:  # noqa: BLE001
            return {
                "status": "not_available", "provider": "google_ads", "account_id": account_id,
                "report_type": report_type, "message": _safe_error(exc, account_config), "rows": [],
                "source_api": "google_ads_api", "preview": False,
            }

    def get_meta_ads_detailed_report(
        account_id: str,
        report_type: str,
        start_date: str | None = None,
        end_date: str | None = None,
        level: str = "ad",
        campaign_id: str | None = None,
        query: str | None = None,
        limit: int = 500,
    ) -> dict:
        account_config = validate_provider_account(registry, policy_manager, "meta_ads", account_id)
        provider = registry.get_provider("meta_ads")
        key = report_type.strip().lower()
        try:
            if key in META_INSIGHT_FIELDS:
                if not start_date or not end_date:
                    raise ValueError(f"start_date and end_date are required for report_type='{key}'.")
                date.fromisoformat(start_date)
                date.fromisoformat(end_date)
                policy_manager.validate_report_range(start_date, end_date)
                params: dict[str, Any] = {}
                if campaign_id:
                    params["filtering"] = [{"field": "campaign.id", "operator": "IN", "value": [campaign_id]}]
                payload = provider.get_flexible_insights(
                    account_id, level, start_date, end_date, META_INSIGHT_FIELDS[key], None, params, limit
                )
                return _add_action_summary(payload, account_config.get("action_metrics"))
            if key in META_OBJECT_REPORTS:
                payload = provider.list_account_objects(account_id, META_OBJECT_REPORTS[key], limit=limit)
                if key == "creatives" and query:
                    needle = query.casefold()
                    payload["rows"] = [row for row in payload.get("rows", []) if needle in str(row).casefold()]
                    payload["row_count"] = len(payload["rows"])
                    payload["search_mode"] = "metadata_text"
                    payload["note"] = "Search covers creative text and metadata, not visual recognition inside images/video."
                return payload
            if key == "billing":
                return provider.get_billing_summary(account_id)
            if key == "connected_assets":
                return provider.get_connected_assets(account_id)
            raise ValueError(
                f"Unsupported Meta report_type='{report_type}'. "
                f"Supported: {sorted([*META_INSIGHT_FIELDS, *META_OBJECT_REPORTS, 'billing', 'connected_assets'])}"
            )
        except Exception as exc:  # noqa: BLE001
            return {
                "status": "not_available", "provider": "meta_ads", "account_id": account_id,
                "report_type": report_type, "message": _safe_error(exc, account_config), "rows": [],
                "source_api": "meta_marketing_api", "preview": False,
            }

    return {
        "list_detailed_ad_report_types": list_detailed_ad_report_types,
        "get_google_ads_detailed_report": get_google_ads_detailed_report,
        "get_meta_ads_detailed_report": get_meta_ads_detailed_report,
    }

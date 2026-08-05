from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.provenance import live_meta_payload

try:
    from facebook_business.adobjects.ad import Ad
    from facebook_business.adobjects.adaccount import AdAccount
    from facebook_business.adobjects.adcreative import AdCreative
    from facebook_business.adobjects.adimage import AdImage
    from facebook_business.adobjects.adset import AdSet
    from facebook_business.adobjects.adspixel import AdsPixel
    from facebook_business.adobjects.advideo import AdVideo
    from facebook_business.adobjects.campaign import Campaign
    from facebook_business.adobjects.customaudience import CustomAudience
    from facebook_business.adobjects.customconversion import CustomConversion
    from facebook_business.api import FacebookAdsApi
except ImportError:  # pragma: no cover
    Ad = None
    AdAccount = None
    AdCreative = None
    AdImage = None
    AdSet = None
    AdsPixel = None
    AdVideo = None
    Campaign = None
    CustomAudience = None
    CustomConversion = None
    FacebookAdsApi = None


ACCOUNT_SUMMARY_FIELDS = [
    "id",
    "account_id",
    "name",
    "account_status",
    "currency",
    "timezone_name",
    "business_name",
    "amount_spent",
    "balance",
    "spend_cap",
    "funding_source",
    "funding_source_details",
    "disable_reason",
    "is_prepay_account",
    "min_daily_budget",
]

DEFAULT_INSIGHTS_FIELDS = [
    "date_start",
    "date_stop",
    "account_id",
    "account_name",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "objective",
    "reach",
    "impressions",
    "frequency",
    "clicks",
    "inline_link_clicks",
    "spend",
    "ctr",
    "cpc",
    "cpm",
    "actions",
    "conversions",
    "video_play_actions",
    "video_thruplay_watched_actions",
]

OBJECT_CONFIG: dict[str, dict[str, Any]] = {
    "campaign": {
        "method": "get_campaigns",
        "class": lambda: Campaign,
        "fields": ["id", "name", "status", "effective_status", "objective", "buying_type", "daily_budget", "lifetime_budget", "spend_cap", "budget_remaining", "created_time", "updated_time", "start_time", "stop_time"],
    },
    "adset": {
        "method": "get_ad_sets",
        "class": lambda: AdSet,
        "fields": ["id", "name", "campaign_id", "status", "effective_status", "optimization_goal", "billing_event", "bid_strategy", "daily_budget", "lifetime_budget", "budget_remaining", "targeting", "promoted_object", "created_time", "updated_time", "start_time", "end_time"],
    },
    "ad_group": {
        "alias": "adset",
    },
    "ad": {
        "method": "get_ads",
        "class": lambda: Ad,
        "fields": ["id", "name", "campaign_id", "adset_id", "status", "effective_status", "configured_status", "creative", "ad_review_feedback", "issues_info", "created_time", "updated_time"],
    },
    "creative": {
        "method": "get_ad_creatives",
        "class": lambda: AdCreative,
        "fields": [
            "id", "name", "status", "body", "title", "object_type", "object_story_id",
            "effective_object_story_id", "object_story_spec", "asset_feed_spec",
            "call_to_action_type", "thumbnail_url", "image_url", "image_hash", "video_id", "url_tags",
        ],
    },
    "audience": {
        "method": "get_custom_audiences",
        "class": lambda: CustomAudience,
        "fields": ["id", "name", "subtype", "description", "approximate_count_lower_bound", "approximate_count_upper_bound", "delivery_status", "operation_status", "permission_for_actions", "time_created", "time_updated"],
    },
    "custom_audience": {
        "alias": "audience",
    },
    "saved_audience": {
        "method": "get_saved_audiences",
        "class": None,
        "fields": ["id", "name", "run_status", "targeting", "time_created", "time_updated"],
    },
    "pixel": {
        "method": "get_ads_pixels",
        "class": lambda: AdsPixel,
        "fields": ["id", "name", "creation_time", "last_fired_time"],
    },
    "custom_conversion": {
        "method": "get_custom_conversions",
        "class": lambda: CustomConversion,
        "fields": ["id", "name", "custom_event_type", "event_source_type", "event_source_id", "first_fired_time", "last_fired_time", "is_archived", "is_unavailable", "rule", "creation_time"],
    },
    "ad_image": {
        "method": "get_ad_images",
        "class": lambda: AdImage,
        "fields": ["id", "name", "hash", "url", "url_128", "created_time", "height", "width", "original_height", "original_width"],
    },
    "ad_video": {
        "method": "get_ad_videos",
        "class": lambda: AdVideo,
        "fields": ["id", "title", "description", "created_time", "updated_time", "length", "permalink_url", "picture", "status"],
    },
    "instagram_account": {
        "method": "get_instagram_accounts",
        "class": None,
        "fields": ["id", "username", "name", "profile_picture_url"],
    },
    "page": {
        "method": "get_promote_pages",
        "class": None,
        "fields": ["id", "name", "link", "category"],
    },
    "activity": {
        "method": "get_activities",
        "class": None,
        "fields": ["event_time", "event_type", "object_id", "object_name", "translated_event_type"],
    },
    "user": {
        "method": "get_users",
        "class": None,
        "fields": ["id", "name", "role"],
    },
    "assigned_user": {
        "method": "get_assigned_users",
        "class": None,
        "fields": ["id", "name", "tasks"],
    },
}

TARGETING_TYPES = {
    "adinterest",
    "adinterestsuggestion",
    "adgeolocation",
    "adlocale",
    "adeducationschool",
    "adworkemployer",
    "adworkposition",
    "adTargetingCategory",
}


def _init(credentials: MetaAccountCredentials) -> None:
    if FacebookAdsApi is None:
        raise RuntimeError("facebook-business SDK is not installed.")
    FacebookAdsApi.init(
        credentials.app_id,
        credentials.app_secret,
        credentials.access_token,
        api_version=credentials.api_version,
    )


def _account(credentials: MetaAccountCredentials) -> AdAccount:
    _init(credentials)
    return AdAccount(f"act_{credentials.account_id}")


def _export_value(value: Any) -> Any:
    if hasattr(value, "export_all_data"):
        return value.export_all_data()
    if isinstance(value, dict):
        return {key: _export_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_export_value(item) for item in value]
    return value


def _rows(cursor: Any, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    safe_limit = max(1, min(int(limit or 100), 1000))
    for item in cursor:
        rows.append(_export_value(dict(item)))
        if len(rows) >= safe_limit:
            break
    return rows


def _canonical_object_type(object_type: str) -> str:
    key = object_type.strip().lower()
    config = OBJECT_CONFIG.get(key)
    if config and "alias" in config:
        return config["alias"]
    return key


def _config_for(object_type: str) -> dict[str, Any]:
    key = _canonical_object_type(object_type)
    try:
        return OBJECT_CONFIG[key]
    except KeyError as exc:
        supported = sorted(OBJECT_CONFIG.keys())
        raise ValueError(f"Unsupported Meta object_type='{object_type}'. Supported: {supported}") from exc


def _node_class(config: dict[str, Any]) -> Callable | None:
    class_factory = config.get("class")
    return class_factory() if callable(class_factory) else None


def fetch_meta_account_summary(credentials: MetaAccountCredentials, fields: list[str] | None = None) -> dict[str, Any]:
    requested_fields = fields or ACCOUNT_SUMMARY_FIELDS
    account = _account(credentials).api_get(fields=requested_fields)
    return live_meta_payload({
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "object_type": "account",
        "fields": requested_fields,
        "data": _export_value(dict(account)),
    }, source_api="meta_marketing_api")


def fetch_meta_objects(
    credentials: MetaAccountCredentials,
    object_type: str,
    fields: list[str] | None = None,
    params: dict[str, Any] | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    canonical_type = _canonical_object_type(object_type)
    config = _config_for(canonical_type)
    requested_fields = fields or config["fields"]
    method_name = config["method"]
    account = _account(credentials)
    method = getattr(account, method_name)
    request_params = dict(params or {})
    cursor = method(fields=requested_fields, params=request_params)
    rows = _rows(cursor, limit)
    return live_meta_payload({
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "object_type": canonical_type,
        "fields": requested_fields,
        "params": request_params,
        "limit": max(1, min(int(limit or 100), 1000)),
        "rows": rows,
        "row_count": len(rows),
    }, source_api="meta_marketing_api")


def fetch_meta_object(
    credentials: MetaAccountCredentials,
    object_type: str,
    object_id: str,
    fields: list[str] | None = None,
) -> dict[str, Any]:
    canonical_type = _canonical_object_type(object_type)
    config = _config_for(canonical_type)
    node_class = _node_class(config)
    if node_class is None:
        raise ValueError(f"Direct get is not available for Meta object_type='{object_type}'. Use list_account_objects instead.")
    requested_fields = fields or config["fields"]
    _init(credentials)
    node = node_class(object_id).api_get(fields=requested_fields)
    return live_meta_payload({
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "object_type": canonical_type,
        "object_id": object_id,
        "fields": requested_fields,
        "data": _export_value(dict(node)),
    }, source_api="meta_marketing_api")


def fetch_meta_flexible_insights(
    credentials: MetaAccountCredentials,
    level: str,
    start_date: str,
    end_date: str,
    fields: list[str] | None = None,
    breakdowns: list[str] | None = None,
    params: dict[str, Any] | None = None,
    limit: int = 500,
) -> dict[str, Any]:
    requested_fields = fields or DEFAULT_INSIGHTS_FIELDS
    request_params = dict(params or {})
    request_params.update(
        {
            "level": level,
            "time_range": {"since": start_date, "until": end_date},
        }
    )
    if breakdowns:
        request_params["breakdowns"] = breakdowns
    if "time_increment" not in request_params:
        request_params["time_increment"] = 1
    cursor = _account(credentials).get_insights(fields=requested_fields, params=request_params)
    rows = _rows(cursor, limit)
    return live_meta_payload({
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "level": level,
        "date_range": {"start_date": start_date, "end_date": end_date},
        "fields": requested_fields,
        "breakdowns": breakdowns or [],
        "params": request_params,
        "limit": max(1, min(int(limit or 500), 1000)),
        "rows": rows,
        "row_count": len(rows),
    }, source_api="meta_marketing_api")


def search_meta_targeting(
    credentials: MetaAccountCredentials,
    query: str,
    targeting_type: str,
    limit: int = 25,
) -> dict[str, Any]:
    if targeting_type not in TARGETING_TYPES:
        supported = sorted(TARGETING_TYPES)
        raise ValueError(f"Unsupported targeting_type='{targeting_type}'. Supported: {supported}")
    params = {
        "q": query,
        "type": targeting_type,
        "limit": max(1, min(int(limit or 25), 100)),
    }
    cursor = _account(credentials).get_targeting_search(params=params)
    rows = _rows(cursor, params["limit"])
    return live_meta_payload({
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "query": query,
        "targeting_type": targeting_type,
        "rows": rows,
        "row_count": len(rows),
    }, source_api="meta_marketing_api")

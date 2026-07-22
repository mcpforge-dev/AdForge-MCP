from __future__ import annotations

from typing import Any

from ad_mcp.core.models import ReportRequest, ReportResponse
from ad_mcp.core.normalization import split_requested_fields
from ad_mcp.providers.google_ads.auth import GoogleAdsCredentials

try:
    from google.ads.googleads.client import GoogleAdsClient
except ImportError:  # pragma: no cover
    GoogleAdsClient = None


FIELD_MAP = {
    "date": "segments.date",
    "campaign": "campaign.name",
    "ad_group": "ad_group.name",
    "ad": "ad_group_ad.ad.id",
    "keyword": "ad_group_criterion.keyword.text",
    "reach": "metrics.unique_users",
    "impressions": "metrics.impressions",
    "interactions": "metrics.interactions",
    "clicks": "metrics.clicks",
    "spend": "metrics.cost_micros",
    "ctr": "metrics.ctr",
    "cr": "metrics.conversions_from_interactions_rate",
    "conversions": "metrics.conversions",
    "quality_score": "ad_group_criterion.quality_info.quality_score",
    "expected_ctr": "ad_group_criterion.quality_info.expected_click_through_rate",
    "landing_page_quality": "ad_group_criterion.quality_info.landing_page_experience",
    "ad_quality": "ad_group_criterion.quality_info.ad_relevance",
    "impression_share": "metrics.search_impression_share",
    "lost_impression_share": "metrics.search_budget_lost_impression_share",
}

FROM_MAP = {
    "account": "customer",
    "campaign": "campaign",
    "ad_group": "ad_group",
    "ad": "ad_group_ad",
    "keyword": "keyword_view",
    "asset": "asset",
    "extension": "asset",
}


def _safe_enum(value: str) -> str:
    safe = "".join(char for char in value.strip().upper() if char.isalnum() or char == "_")
    if not safe:
        raise ValueError("Google Ads enum filter is empty.")
    return safe


def _normalize_value(field: str, value: Any) -> Any:
    if field == "spend" and value is not None:
        return float(value) / 1_000_000
    return value


def fetch_google_report(
    credentials: GoogleAdsCredentials,
    request: ReportRequest,
    supported_metrics: list[str],
) -> ReportResponse:
    matched, unsupported = split_requested_fields(
        request.fields or supported_metrics,
        supported_metrics,
    )
    if GoogleAdsClient is None:
        return ReportResponse(
            provider="google_ads",
            entity_level=request.entity_level,
            date_range=request.date_range,
            rows=[],
            normalized_metrics=matched,
            native_metrics=[],
            unsupported_requested_fields=unsupported,
            source_api="google_ads_api",
            preview=True,
        )

    config: dict[str, Any] = {
        "developer_token": credentials.developer_token,
        "client_id": credentials.oauth_client_id,
        "client_secret": credentials.oauth_client_secret,
        "refresh_token": credentials.refresh_token,
        "use_proto_plus": True,
    }
    if credentials.login_customer_id:
        config["login_customer_id"] = credentials.login_customer_id
    client = GoogleAdsClient.load_from_dict(config)
    service = client.get_service("GoogleAdsService")

    select_fields = ["segments.date"]
    identity_fields = {
        "campaign": ["campaign.id", "campaign.name"],
        "ad_group": ["campaign.id", "campaign.name", "ad_group.id", "ad_group.name"],
        "ad": ["campaign.id", "campaign.name", "ad_group.id", "ad_group.name", "ad_group_ad.ad.id", "ad_group_ad.ad.name"],
        "keyword": ["campaign.id", "campaign.name", "ad_group.id", "ad_group.name", "ad_group_criterion.criterion_id", "ad_group_criterion.keyword.text"],
    }
    select_fields.extend(identity_fields.get(request.entity_level, []))
    for field in matched:
        api_field = FIELD_MAP.get(field)
        if api_field and api_field not in select_fields:
            select_fields.append(api_field)
    from_resource = FROM_MAP.get(request.entity_level, "campaign")
    where = [
        f"segments.date BETWEEN '{request.date_range.start_date}' AND '{request.date_range.end_date}'",
    ]
    campaign_id = str(request.filters.get("campaign_id") or "").strip()
    if campaign_id and from_resource in {"campaign", "ad_group", "ad_group_ad", "keyword_view"}:
        if not campaign_id.isdigit():
            raise ValueError("Google Ads campaign_id must be numeric.")
        where.append(f"campaign.id = {campaign_id}")
    status = str(request.filters.get("status") or "").strip()
    if status and from_resource in {"campaign", "ad_group", "ad_group_ad", "keyword_view"}:
        where.append(f"campaign.status = '{_safe_enum(status)}'")
    query = (
        f"SELECT {', '.join(select_fields)} "
        f"FROM {from_resource} "
        f"WHERE {' AND '.join(where)}"
    )

    rows: list[dict[str, Any]] = []
    for batch in service.search_stream(customer_id=credentials.customer_id, query=query):
        for result in batch.results:
            row: dict[str, Any] = {"date": str(result.segments.date)}
            if request.entity_level in {"campaign", "ad_group", "ad", "keyword"}:
                row.update({"campaign_id": result.campaign.id, "campaign_name": result.campaign.name})
            if request.entity_level in {"ad_group", "ad", "keyword"}:
                row.update({"ad_group_id": result.ad_group.id, "ad_group_name": result.ad_group.name})
            if request.entity_level == "ad":
                row.update({"ad_id": result.ad_group_ad.ad.id, "ad_name": result.ad_group_ad.ad.name})
            if request.entity_level == "keyword":
                row.update({
                    "keyword_id": result.ad_group_criterion.criterion_id,
                    "keyword_text": result.ad_group_criterion.keyword.text,
                })
            for field in matched:
                api_field = FIELD_MAP.get(field)
                if not api_field:
                    continue
                value: Any = None
                if api_field == "campaign.name":
                    value = result.campaign.name
                elif api_field == "ad_group.name":
                    value = result.ad_group.name
                elif api_field == "ad_group_ad.ad.id":
                    value = result.ad_group_ad.ad.id
                elif api_field == "ad_group_criterion.keyword.text":
                    value = result.ad_group_criterion.keyword.text
                elif api_field == "metrics.impressions":
                    value = result.metrics.impressions
                elif api_field == "metrics.interactions":
                    value = result.metrics.interactions
                elif api_field == "metrics.clicks":
                    value = result.metrics.clicks
                elif api_field == "metrics.cost_micros":
                    value = result.metrics.cost_micros
                elif api_field == "metrics.ctr":
                    value = result.metrics.ctr
                elif api_field == "metrics.conversions_from_interactions_rate":
                    value = result.metrics.conversions_from_interactions_rate
                elif api_field == "metrics.conversions":
                    value = result.metrics.conversions
                elif api_field == "metrics.unique_users":
                    value = getattr(result.metrics, "unique_users", None)
                elif api_field == "metrics.search_impression_share":
                    value = result.metrics.search_impression_share
                elif api_field == "metrics.search_budget_lost_impression_share":
                    value = result.metrics.search_budget_lost_impression_share
                elif api_field == "ad_group_criterion.quality_info.quality_score":
                    value = result.ad_group_criterion.quality_info.quality_score
                elif api_field == "ad_group_criterion.quality_info.expected_click_through_rate":
                    value = str(result.ad_group_criterion.quality_info.expected_click_through_rate)
                elif api_field == "ad_group_criterion.quality_info.landing_page_experience":
                    value = str(result.ad_group_criterion.quality_info.landing_page_experience)
                elif api_field == "ad_group_criterion.quality_info.ad_relevance":
                    value = str(result.ad_group_criterion.quality_info.ad_relevance)
                row[field] = _normalize_value(field, value)
            rows.append(row)

    return ReportResponse(
        provider="google_ads",
        entity_level=request.entity_level,
        date_range=request.date_range,
        rows=rows,
        normalized_metrics=matched,
        native_metrics=[],
        unsupported_requested_fields=unsupported,
        source_api="google_ads_api",
        preview=False,
    )

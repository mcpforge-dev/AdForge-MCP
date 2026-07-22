from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from ad_mcp.providers.google_ads.auth import GoogleAdsCredentials

try:
    from google.ads.googleads.client import GoogleAdsClient
except ImportError:  # pragma: no cover
    GoogleAdsClient = None


@dataclass(frozen=True, slots=True)
class GoogleReportSpec:
    resource: str
    fields: tuple[str, ...]
    dated: bool = True
    order_by: str | None = "metrics.cost_micros DESC"
    notes: tuple[str, ...] = ()


COMMON_METRICS = (
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.ctr",
    "metrics.average_cpc",
    "metrics.conversions",
    "metrics.cost_per_conversion",
)

GOOGLE_REPORT_SPECS: dict[str, GoogleReportSpec] = {
    "search_terms": GoogleReportSpec(
        "search_term_view",
        (
            "campaign.id", "campaign.name", "ad_group.id", "ad_group.name",
            "search_term_view.search_term", "search_term_view.status",
            "segments.search_term_match_type", *COMMON_METRICS,
        ),
    ),
    "keywords": GoogleReportSpec(
        "keyword_view",
        (
            "campaign.id", "campaign.name", "ad_group.id", "ad_group.name",
            "ad_group_criterion.criterion_id", "ad_group_criterion.keyword.text",
            "ad_group_criterion.keyword.match_type", "ad_group_criterion.status",
            "ad_group_criterion.quality_info.quality_score", *COMMON_METRICS,
        ),
    ),
    "ads": GoogleReportSpec(
        "ad_group_ad",
        (
            "campaign.id", "campaign.name", "ad_group.id", "ad_group.name",
            "ad_group_ad.ad.id", "ad_group_ad.ad.name", "ad_group_ad.status",
            "ad_group_ad.ad.type", "ad_group_ad.ad.final_urls",
            "ad_group_ad.ad.responsive_search_ad.headlines",
            "ad_group_ad.ad.responsive_search_ad.descriptions", *COMMON_METRICS,
        ),
    ),
    "ad_groups": GoogleReportSpec(
        "ad_group",
        (
            "campaign.id", "campaign.name", "ad_group.id", "ad_group.name",
            "ad_group.status", "ad_group.type", "ad_group.cpc_bid_micros", *COMMON_METRICS,
        ),
    ),
    "bidding": GoogleReportSpec(
        "campaign",
        (
            "campaign.id", "campaign.name", "campaign.status",
            "campaign.bidding_strategy_type", "campaign.bidding_strategy",
            "campaign.bidding_strategy_system_status", "campaign_budget.id",
            "campaign_budget.name", "campaign_budget.amount_micros",
            "campaign_budget.total_amount_micros", "campaign_budget.type",
        ),
        dated=False,
        order_by="campaign.id",
    ),
    "conversions": GoogleReportSpec(
        "customer",
        (
            "segments.conversion_action", "segments.conversion_action_name",
            "segments.conversion_action_category", "segments.external_conversion_source",
            "metrics.conversions", "metrics.all_conversions", "metrics.conversions_value",
            "metrics.all_conversions_value", "metrics.cost_per_conversion",
        ),
        order_by="metrics.all_conversions DESC",
        notes=("Includes imported GA4 events when Google Ads exposes them as conversion actions.",),
    ),
    "auction_insights": GoogleReportSpec(
        "campaign",
        (
            "campaign.id", "campaign.name", "segments.auction_insight_domain",
            "metrics.auction_insight_search_impression_share",
            "metrics.auction_insight_search_overlap_rate",
            "metrics.auction_insight_search_position_above_rate",
            "metrics.auction_insight_search_outranking_share",
            "metrics.auction_insight_search_top_impression_percentage",
            "metrics.auction_insight_search_absolute_top_impression_percentage",
        ),
        order_by="metrics.auction_insight_search_impression_share DESC",
        notes=("Auction insight rows are available only for eligible Search campaigns with sufficient activity.",),
    ),
    "change_history": GoogleReportSpec(
        "change_event",
        (
            "change_event.change_date_time", "change_event.user_email",
            "change_event.client_type", "change_event.change_resource_type",
            "change_event.change_resource_name", "change_event.resource_change_operation",
            "change_event.changed_fields",
        ),
        dated=False,
        order_by="change_event.change_date_time DESC",
        notes=("Google Ads exposes change events only for the most recent 30 days and caps results at 10,000 rows.",),
    ),
    "account_budget": GoogleReportSpec(
        "account_budget",
        (
            "customer.id", "customer.descriptive_name", "customer.currency_code",
            "account_budget.id", "account_budget.name", "account_budget.status",
            "account_budget.approved_start_date_time", "account_budget.approved_end_date_time",
            "account_budget.approved_spending_limit_micros",
            "account_budget.approved_spending_limit_type",
            "account_budget.adjusted_spending_limit_micros",
            "account_budget.amount_served_micros", "account_budget.total_adjustments_micros",
        ),
        dated=False,
        order_by="account_budget.approved_start_date_time DESC",
        notes=(
            "Account budgets are generally available only to accounts using consolidated/monthly invoicing.",
            "Google Ads API does not provide a universal wallet balance for every billing setup.",
        ),
    ),
}


def _clean_id(value: str | None, label: str) -> str | None:
    if value in (None, ""):
        return None
    cleaned = "".join(char for char in str(value) if char.isdigit())
    if not cleaned:
        raise ValueError(f"{label} must be numeric.")
    return cleaned


def build_google_detailed_query(
    report_type: str,
    start_date: str | None,
    end_date: str | None,
    *,
    campaign_id: str | None = None,
    ad_group_id: str | None = None,
    limit: int = 500,
) -> tuple[str, GoogleReportSpec]:
    key = report_type.strip().lower()
    try:
        spec = GOOGLE_REPORT_SPECS[key]
    except KeyError as exc:
        raise ValueError(f"Unsupported Google report_type='{report_type}'. Supported: {sorted(GOOGLE_REPORT_SPECS)}") from exc

    safe_limit = max(1, min(int(limit or 500), 10_000 if key == "change_history" else 1_000))
    fields = list(spec.fields)
    where: list[str] = []
    if spec.dated:
        if not start_date or not end_date:
            raise ValueError(f"start_date and end_date are required for report_type='{key}'.")
        date.fromisoformat(start_date)
        date.fromisoformat(end_date)
        fields.insert(0, "segments.date")
        where.append(f"segments.date BETWEEN '{start_date}' AND '{end_date}'")
    elif key == "change_history":
        end = date.fromisoformat(end_date) if end_date else date.today()
        start = date.fromisoformat(start_date) if start_date else end - timedelta(days=29)
        if (end - start).days > 29:
            start = end - timedelta(days=29)
        where.append(
            f"change_event.change_date_time >= '{start.isoformat()} 00:00:00' "
            f"AND change_event.change_date_time <= '{end.isoformat()} 23:59:59'"
        )

    safe_campaign_id = _clean_id(campaign_id, "campaign_id")
    if safe_campaign_id and spec.resource not in {"customer", "change_event", "account_budget"}:
        where.append(f"campaign.id = {safe_campaign_id}")
    safe_ad_group_id = _clean_id(ad_group_id, "ad_group_id")
    if safe_ad_group_id and spec.resource in {"search_term_view", "keyword_view", "ad_group_ad", "ad_group"}:
        where.append(f"ad_group.id = {safe_ad_group_id}")

    query = f"SELECT {', '.join(fields)} FROM {spec.resource}"
    if where:
        query += f" WHERE {' AND '.join(where)}"
    if spec.order_by:
        query += f" ORDER BY {spec.order_by}"
    query += f" LIMIT {safe_limit}"
    return query, spec


def _export_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "paths"):
        return list(value.paths)
    if isinstance(value, (list, tuple)) or type(value).__name__.endswith("Repeated"):
        return [_export_value(item) for item in value]
    if hasattr(value, "text"):
        return {"text": value.text, "pinned_field": str(getattr(value, "pinned_field", ""))}
    if hasattr(value, "name") and type(value).__module__.startswith("google"):
        return str(value)
    return str(value)


def _read_path(result: Any, path: str) -> Any:
    value = result
    for part in path.split("."):
        value = getattr(value, part, None)
        if value is None:
            return None
    return _export_value(value)


def _normalize_field(field: str, value: Any) -> Any:
    key = field.rsplit(".", 1)[-1]
    if field.endswith("_micros") or key in {"cost_micros", "average_cpc", "cost_per_conversion"}:
        try:
            return round(float(value) / 1_000_000, 6)
        except (TypeError, ValueError):
            return value
    return value


def fetch_google_detailed_report(
    credentials: GoogleAdsCredentials,
    report_type: str,
    start_date: str | None,
    end_date: str | None,
    *,
    campaign_id: str | None = None,
    ad_group_id: str | None = None,
    limit: int = 500,
) -> dict[str, Any]:
    query, spec = build_google_detailed_query(
        report_type, start_date, end_date, campaign_id=campaign_id, ad_group_id=ad_group_id, limit=limit
    )
    if GoogleAdsClient is None:
        return {
            "status": "not_available", "provider": "google_ads", "report_type": report_type,
            "message": "google-ads SDK is not installed.", "rows": [], "preview": True,
        }
    config: dict[str, Any] = {
        "developer_token": credentials.developer_token,
        "client_id": credentials.oauth_client_id,
        "client_secret": credentials.oauth_client_secret,
        "refresh_token": credentials.refresh_token,
        "use_proto_plus": True,
    }
    if credentials.login_customer_id:
        config["login_customer_id"] = credentials.login_customer_id
    service = GoogleAdsClient.load_from_dict(config).get_service("GoogleAdsService")
    selected_fields = [field.strip() for field in query.split(" FROM ", 1)[0].removeprefix("SELECT ").split(",")]
    rows: list[dict[str, Any]] = []
    for batch in service.search_stream(customer_id=credentials.customer_id, query=query):
        for result in batch.results:
            row = {
                field: _normalize_field(field, _read_path(result, field))
                for field in selected_fields
            }
            rows.append(row)
    return {
        "status": "ok", "provider": "google_ads", "account_id": credentials.account_id,
        "report_type": report_type.strip().lower(), "date_range": {"start_date": start_date, "end_date": end_date},
        "row_count": len(rows), "rows": rows, "notes": list(spec.notes),
        "source_api": "google_ads_api", "preview": False,
    }

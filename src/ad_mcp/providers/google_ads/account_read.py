from __future__ import annotations

from typing import Any

from ad_mcp.providers.google_ads.auth import GoogleAdsCredentials

try:
    from google.ads.googleads.client import GoogleAdsClient
except ImportError:  # pragma: no cover
    GoogleAdsClient = None


CAMPAIGN_FIELDS = [
    "campaign.id",
    "campaign.name",
    "campaign.status",
    "campaign.advertising_channel_type",
    "campaign.start_date_time",
    "campaign.end_date_time",
    "campaign_budget.amount_micros",
    "campaign_budget.delivery_method",
    "customer.currency_code",
]


def _client(credentials: GoogleAdsCredentials) -> Any:
    if GoogleAdsClient is None:
        raise RuntimeError("google-ads SDK is not installed.")
    config: dict[str, Any] = {
        "developer_token": credentials.developer_token,
        "client_id": credentials.oauth_client_id,
        "client_secret": credentials.oauth_client_secret,
        "refresh_token": credentials.refresh_token,
        "use_proto_plus": True,
    }
    if credentials.login_customer_id:
        config["login_customer_id"] = credentials.login_customer_id
    return GoogleAdsClient.load_from_dict(config)


def _enum_name(value: Any) -> str | None:
    name = getattr(value, "name", None)
    if name:
        return str(name)
    if value in (None, ""):
        return None
    return str(value)


def _safe_enum(value: str) -> str:
    safe = "".join(char for char in value.strip().upper() if char.isalnum() or char == "_")
    if not safe:
        raise ValueError("Google Ads enum filter is empty.")
    return safe


def _campaign_row(result: Any) -> dict[str, Any]:
    campaign = result.campaign
    budget = result.campaign_budget
    amount_micros = getattr(budget, "amount_micros", None)
    start_date_time = getattr(campaign, "start_date_time", None) or None
    end_date_time = getattr(campaign, "end_date_time", None) or None
    return {
        "id": str(campaign.id),
        "name": campaign.name,
        "status": _enum_name(campaign.status),
        "advertising_channel_type": _enum_name(campaign.advertising_channel_type),
        "start_date": str(start_date_time)[:10] if start_date_time else None,
        "end_date": str(end_date_time)[:10] if end_date_time else None,
        "start_date_time": start_date_time,
        "end_date_time": end_date_time,
        "daily_budget": (float(amount_micros) / 1_000_000) if amount_micros is not None else None,
        "daily_budget_micros": amount_micros,
        "budget_delivery_method": _enum_name(budget.delivery_method),
        "currency": getattr(result.customer, "currency_code", None),
    }


def fetch_google_campaigns(
    credentials: GoogleAdsCredentials,
    *,
    status: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    client = _client(credentials)
    service = client.get_service("GoogleAdsService")
    safe_limit = max(1, min(int(limit or 100), 1000))
    where: list[str] = []
    if status:
        where.append(f"campaign.status = '{_safe_enum(status)}'")
    query = f"SELECT {', '.join(CAMPAIGN_FIELDS)} FROM campaign"
    if where:
        query += " WHERE " + " AND ".join(where)
    query += f" LIMIT {safe_limit}"

    rows: list[dict[str, Any]] = []
    for batch in service.search_stream(customer_id=credentials.customer_id, query=query):
        for result in batch.results:
            rows.append(_campaign_row(result))
            if len(rows) >= safe_limit:
                break

    return {
        "provider": "google_ads",
        "account_id": credentials.customer_id,
        "object_type": "campaign",
        "fields": CAMPAIGN_FIELDS,
        "params": {"status": status} if status else {},
        "limit": safe_limit,
        "rows": rows,
        "row_count": len(rows),
        "source_api": "google_ads_api",
        "preview": False,
    }


def fetch_google_campaign(credentials: GoogleAdsCredentials, campaign_id: str) -> dict[str, Any]:
    client = _client(credentials)
    service = client.get_service("GoogleAdsService")
    clean_campaign_id = str(campaign_id).strip()
    if not clean_campaign_id.isdigit():
        raise ValueError("Google Ads campaign_id must be numeric.")
    query = (
        f"SELECT {', '.join(CAMPAIGN_FIELDS)} "
        "FROM campaign "
        f"WHERE campaign.id = {clean_campaign_id} "
        "LIMIT 1"
    )
    rows: list[dict[str, Any]] = []
    for batch in service.search_stream(customer_id=credentials.customer_id, query=query):
        for result in batch.results:
            rows.append(_campaign_row(result))

    return {
        "provider": "google_ads",
        "account_id": credentials.customer_id,
        "object_type": "campaign",
        "object_id": clean_campaign_id,
        "fields": CAMPAIGN_FIELDS,
        "data": rows[0] if rows else None,
        "status": "ok" if rows else "not_found",
        "source_api": "google_ads_api",
        "preview": False,
    }

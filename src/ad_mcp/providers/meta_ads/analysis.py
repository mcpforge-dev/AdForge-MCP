from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from ad_mcp.providers.meta_ads.account_read import (
    fetch_meta_flexible_insights,
    fetch_meta_objects,
)
from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.billing import fetch_meta_billing_summary
from ad_mcp.providers.meta_ads.graph_read import (
    get_page_instagram_account,
    list_meta_pages,
)
from ad_mcp.providers.meta_ads.provenance import live_meta_payload

try:
    from facebook_business.adobjects.adaccount import AdAccount
    from facebook_business.adobjects.adcreative import AdCreative
    from facebook_business.adobjects.page import Page
    from facebook_business.api import FacebookAdsApi
    from facebook_business.exceptions import FacebookRequestError
except ImportError:  # pragma: no cover
    FacebookRequestError = None
    AdAccount = None
    AdCreative = None
    Page = None
    FacebookAdsApi = None


def _safe_float(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _sum_actions(actions: list[dict[str, Any]] | None, allowed_types: list[str] | None = None) -> float:
    total = 0.0
    for action in actions or []:
        action_type = action.get("action_type")
        if allowed_types and action_type not in allowed_types:
            continue
        total += _safe_float(action.get("value"))
    return total


def _daterange(end_date: str, days: int) -> tuple[str, str]:
    end = date.fromisoformat(end_date)
    start = end - timedelta(days=max(days - 1, 0))
    return start.isoformat(), end.isoformat()


def _get_rows(
    credentials: MetaAccountCredentials,
    level: str,
    start_date: str,
    end_date: str,
    fields: list[str],
    breakdowns: list[str] | None = None,
    limit: int = 1000,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    result = fetch_meta_flexible_insights(
        credentials=credentials,
        level=level,
        start_date=start_date,
        end_date=end_date,
        fields=fields,
        breakdowns=breakdowns,
        params=params,
        limit=limit,
    )
    return result["rows"]


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


def _pick_page_id(credentials: MetaAccountCredentials, page_id: str | None = None) -> str | None:
    if page_id:
        return page_id
    pages = fetch_meta_objects(credentials, "page", limit=1)
    if pages["rows"]:
        return str(pages["rows"][0].get("id"))
    return None


def _aggregate_by_entity(
    rows: list[dict[str, Any]],
    entity_level: str,
    conversion_action_types: list[str] | None,
) -> list[dict[str, Any]]:
    key_id = f"{entity_level}_id"
    key_name = f"{entity_level}_name"
    grouped: dict[str, dict[str, Any]] = {}

    for row in rows:
        entity_id = row.get(key_id) or row.get(key_name) or "unknown"
        entity_name = row.get(key_name) or row.get(key_id) or "unknown"
        item = grouped.setdefault(
            entity_id,
            {
                "entity_id": entity_id,
                "entity_name": entity_name,
                "spend": 0.0,
                "impressions": 0.0,
                "reach": 0.0,
                "clicks": 0.0,
                "inline_link_clicks": 0.0,
                "conversions": 0.0,
                "frequency_values": [],
                "cpm_values": [],
                "ctr_values": [],
                "objective": row.get("objective"),
            },
        )
        item["spend"] += _safe_float(row.get("spend"))
        item["impressions"] += _safe_float(row.get("impressions"))
        item["reach"] += _safe_float(row.get("reach"))
        item["clicks"] += _safe_float(row.get("clicks"))
        item["inline_link_clicks"] += _safe_float(row.get("inline_link_clicks"))
        item["conversions"] += _sum_actions(row.get("actions"), conversion_action_types)
        if row.get("frequency") not in (None, ""):
            item["frequency_values"].append(_safe_float(row.get("frequency")))
        if row.get("cpm") not in (None, ""):
            item["cpm_values"].append(_safe_float(row.get("cpm")))
        if row.get("ctr") not in (None, ""):
            item["ctr_values"].append(_safe_float(row.get("ctr")))

    results: list[dict[str, Any]] = []
    for item in grouped.values():
        impressions = item["impressions"]
        clicks = item["inline_link_clicks"] or item["clicks"]
        spend = item["spend"]
        conversions = item["conversions"]
        results.append(
            {
                "entity_id": item["entity_id"],
                "entity_name": item["entity_name"],
                "objective": item["objective"],
                "spend": round(spend, 2),
                "impressions": round(impressions, 0),
                "reach": round(item["reach"], 0),
                "clicks": round(clicks, 0),
                "conversions": round(conversions, 2),
                "ctr": round((clicks / impressions * 100) if impressions else 0.0, 4),
                "cpc": round((spend / clicks) if clicks else 0.0, 2),
                "cpm": round((spend / impressions * 1000) if impressions else 0.0, 2),
                "cost_per_result": round((spend / conversions) if conversions else 0.0, 2),
                "frequency_avg": round(sum(item["frequency_values"]) / len(item["frequency_values"]), 2) if item["frequency_values"] else 0.0,
                "ctr_avg": round(sum(item["ctr_values"]) / len(item["ctr_values"]), 4) if item["ctr_values"] else 0.0,
                "cpm_avg": round(sum(item["cpm_values"]) / len(item["cpm_values"]), 2) if item["cpm_values"] else 0.0,
            }
        )
    return results


def fetch_meta_spend_overview(credentials: MetaAccountCredentials, end_date: str) -> dict[str, Any]:
    periods = {"today": 1, "last_7_days": 7, "last_30_days": 30}
    rows = []
    for label, days in periods.items():
        start, end = _daterange(end_date, days)
        data = _get_rows(credentials, "account", start, end, ["spend", "impressions", "reach", "clicks", "inline_link_clicks"], limit=100)
        spend = sum(_safe_float(row.get("spend")) for row in data)
        clicks = sum(_safe_float(row.get("inline_link_clicks") or row.get("clicks")) for row in data)
        impressions = sum(_safe_float(row.get("impressions")) for row in data)
        rows.append(
            {
                "period": label,
                "start_date": start,
                "end_date": end,
                "spend": round(spend, 2),
                "clicks": round(clicks, 0),
                "impressions": round(impressions, 0),
                "ctr": round((clicks / impressions * 100) if impressions else 0.0, 4),
            }
        )
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "end_date": end_date,
        "periods": rows,
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def estimate_meta_budget_days_remaining(credentials: MetaAccountCredentials, end_date: str, lookback_days: int = 7) -> dict[str, Any]:
    billing = fetch_meta_billing_summary(credentials)
    overview = fetch_meta_spend_overview(credentials, end_date)
    period_label = "last_7_days" if lookback_days <= 7 else "last_30_days"
    chosen = next(item for item in overview["periods"] if item["period"] == period_label)
    divisor = 7 if period_label == "last_7_days" else 30
    avg_daily_spend = round(chosen["spend"] / divisor, 2)
    balance_due = billing["billing"]["balance_due"]
    has_spend_cap = billing["billing"]["has_spend_cap"]
    spend_cap = billing["billing"]["spend_cap"] or 0.0
    amount_spent_lifetime = billing["billing"]["amount_spent_lifetime"] or 0.0
    available_until_cap = max(spend_cap - amount_spent_lifetime, 0.0) if has_spend_cap else None
    if billing["billing"]["is_prepay_account"]:
        estimated_days = round((balance_due or 0.0) / avg_daily_spend, 1) if avg_daily_spend else None
        explanation = "Prepay account: estimate uses current balance as remaining prepaid funds."
    elif has_spend_cap:
        estimated_days = round((available_until_cap or 0.0) / avg_daily_spend, 1) if avg_daily_spend else None
        explanation = "Postpay account with spend cap: estimate uses remaining amount until spend_cap."
    else:
        estimated_days = None
        explanation = "Postpay account without spend cap: Meta does not expose a fixed remaining account budget runway."
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "billing_model": "prepay" if billing["billing"]["is_prepay_account"] else "postpay",
        "avg_daily_spend": avg_daily_spend,
        "balance_due": balance_due,
        "spend_cap": spend_cap,
        "amount_spent_lifetime": amount_spent_lifetime,
        "estimated_days_remaining": estimated_days,
        "explanation": explanation,
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def fetch_meta_connected_assets(credentials: MetaAccountCredentials) -> dict[str, Any]:
    assets: dict[str, list[dict[str, Any]]] = {
        "pages": [],
        "instagram_accounts": [],
        "pixels": [],
        "custom_conversions": [],
    }
    warnings: list[dict[str, str]] = []
    try:
        assets["pages"] = list_meta_pages(credentials, limit=20)["pages"]
        for page in assets["pages"]:
            page_id = str(page.get("id") or "")
            if not page_id:
                continue
            linked = get_page_instagram_account(credentials, page_id)
            instagram = linked.get("instagram_account")
            if isinstance(instagram, dict):
                assets["instagram_accounts"].append({**instagram, "facebook_page_id": page_id})
            elif linked.get("data_status") == "additional_permission_required":
                warnings.append(
                    {
                        "asset_type": "instagram_accounts",
                        "status": "additional_permission_required",
                        "message": "instagram_basic is required for Instagram profile data.",
                    }
                )
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        for secret in (credentials.access_token, credentials.app_secret):
            if secret:
                message = message.replace(secret, "[redacted]")
        warnings.append(
            {
                "asset_type": "pages_and_instagram",
                "status": "permission_or_api_unavailable",
                "message": message[:500],
            }
        )
    for result_key, object_type in (("pixels", "pixel"), ("custom_conversions", "custom_conversion")):
        try:
            assets[result_key] = fetch_meta_objects(credentials, object_type, limit=20)["rows"]
        except Exception as exc:  # noqa: BLE001
            assets[result_key] = []
            message = str(exc)
            for secret in (credentials.access_token, credentials.app_secret):
                if secret:
                    message = message.replace(secret, "[redacted]")
            warnings.append(
                {
                    "asset_type": result_key,
                    "status": "permission_or_api_unavailable",
                    "message": message[:500],
                }
            )
    return live_meta_payload({
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "assets": assets,
        "summary": {key: len(rows) for key, rows in assets.items()},
        "warnings": warnings,
        "partial": bool(warnings),
    }, source_api="meta_graph_api+meta_marketing_api")


def fetch_meta_delivery_issues(credentials: MetaAccountCredentials, limit: int = 100) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    for object_type in ("campaign", "adset", "ad"):
        rows = fetch_meta_objects(credentials, object_type, limit=limit)["rows"]
        for row in rows:
            status = row.get("effective_status") or row.get("status")
            review = row.get("ad_review_feedback")
            has_issues = bool(row.get("issues_info"))
            if status not in {"ACTIVE"} or review or has_issues:
                issues.append(
                    {
                        "object_type": object_type,
                        "id": row.get("id"),
                        "name": row.get("name"),
                        "status": status,
                        "review_feedback": review,
                        "issues_info": row.get("issues_info"),
                    }
                )
    billing = fetch_meta_billing_summary(credentials)
    if billing.get("billing", {}).get("balance_due", 0) not in (0, 0.0, None):
        issues.append(
            {
                "object_type": "account",
                "id": f"act_{credentials.account_id}",
                "name": billing.get("account_name"),
                "status": "BILLING_BALANCE_DUE",
                "review_feedback": None,
                "issues_info": {"balance_due": billing["billing"]["balance_due"]},
            }
        )
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "issues": issues[:limit],
        "issue_count": len(issues[:limit]),
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def rank_meta_entities(
    credentials: MetaAccountCredentials,
    entity_level: str,
    start_date: str,
    end_date: str,
    metric: str,
    limit: int = 5,
) -> dict[str, Any]:
    rows = _get_rows(
        credentials,
        entity_level,
        start_date,
        end_date,
        ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "objective", "spend", "impressions", "reach", "clicks", "inline_link_clicks", "ctr", "cpm", "actions"],
        limit=1000,
        params={"time_increment": "all_days"},
    )
    ranked = _aggregate_by_entity(rows, entity_level, credentials.action_metrics)
    reverse_metrics = {"spend", "impressions", "reach", "clicks", "conversions", "ctr"}
    if metric == "cost_per_result":
        ranked.sort(
            key=lambda item: item.get("cost_per_result", 0.0) if item.get("conversions", 0) > 0 else float("inf")
        )
    else:
        ranked.sort(key=lambda item: item.get(metric, 0.0), reverse=metric in reverse_metrics)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "entity_level": entity_level,
        "metric": metric,
        "rows": ranked[:limit],
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def compare_meta_periods(
    credentials: MetaAccountCredentials,
    entity_level: str,
    start_date_a: str,
    end_date_a: str,
    start_date_b: str,
    end_date_b: str,
) -> dict[str, Any]:
    fields = ["spend", "impressions", "reach", "clicks", "inline_link_clicks", "actions"]
    rows_a = _get_rows(credentials, entity_level, start_date_a, end_date_a, fields, limit=1000, params={"time_increment": "all_days"})
    rows_b = _get_rows(credentials, entity_level, start_date_b, end_date_b, fields, limit=1000, params={"time_increment": "all_days"})
    agg_a = _aggregate_by_entity(rows_a, entity_level, credentials.action_metrics)
    agg_b = _aggregate_by_entity(rows_b, entity_level, credentials.action_metrics)

    def _totals(items: list[dict[str, Any]]) -> dict[str, float]:
        return {
            "spend": round(sum(item["spend"] for item in items), 2),
            "impressions": round(sum(item["impressions"] for item in items), 0),
            "clicks": round(sum(item["clicks"] for item in items), 0),
            "conversions": round(sum(item["conversions"] for item in items), 2),
        }

    totals_a = _totals(agg_a)
    totals_b = _totals(agg_b)
    delta = {key: round(totals_a[key] - totals_b[key], 2) for key in totals_a}
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "entity_level": entity_level,
        "period_a": {"start_date": start_date_a, "end_date": end_date_a, "totals": totals_a},
        "period_b": {"start_date": start_date_b, "end_date": end_date_b, "totals": totals_b},
        "delta_a_minus_b": delta,
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def detect_meta_anomalies(credentials: MetaAccountCredentials, entity_level: str, end_date: str, lookback_days: int = 7) -> dict[str, Any]:
    lookback_days = max(lookback_days, 6)
    end = date.fromisoformat(end_date)
    recent_start = (end - timedelta(days=2)).isoformat()
    previous_start = (end - timedelta(days=5)).isoformat()
    previous_end = (end - timedelta(days=3)).isoformat()
    compare = compare_meta_periods(credentials, entity_level, recent_start, end_date, previous_start, previous_end)
    recent = compare["period_a"]["totals"]
    previous = compare["period_b"]["totals"]
    anomalies: list[dict[str, Any]] = []
    for metric in ("spend", "clicks", "conversions"):
        prev = previous[metric]
        curr = recent[metric]
        if prev == 0 and curr > 0:
            anomalies.append({"metric": metric, "direction": "up", "change_percent": None, "message": f"{metric} появился после нулевого предыдущего периода."})
        elif prev > 0:
            change_pct = round((curr - prev) / prev * 100, 2)
            if abs(change_pct) >= 30:
                anomalies.append({"metric": metric, "direction": "up" if change_pct > 0 else "down", "change_percent": change_pct, "message": f"{metric} изменился на {change_pct}%."})
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "entity_level": entity_level,
        "recent_period": {"start_date": recent_start, "end_date": end_date},
        "previous_period": {"start_date": previous_start, "end_date": previous_end},
        "anomalies": anomalies,
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def analyze_meta_audiences(credentials: MetaAccountCredentials, start_date: str, end_date: str, limit: int = 20) -> dict[str, Any]:
    rows = _get_rows(
        credentials,
        "adset",
        start_date,
        end_date,
        ["adset_id", "adset_name", "campaign_name", "spend", "impressions", "reach", "clicks", "inline_link_clicks", "ctr", "cpm", "actions", "frequency"],
        limit=1000,
        params={"time_increment": "all_days"},
    )
    result_rows = _aggregate_by_entity(rows, "adset", credentials.action_metrics)
    result_rows.sort(key=lambda item: (item["cost_per_result"] if item["conversions"] else 999999, -item["ctr"]))
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": result_rows[:limit],
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def find_meta_burnout_ads(credentials: MetaAccountCredentials, start_date: str, end_date: str, limit: int = 20) -> dict[str, Any]:
    rows = _get_rows(
        credentials,
        "ad",
        start_date,
        end_date,
        ["date_start", "ad_id", "ad_name", "spend", "impressions", "inline_link_clicks", "ctr", "cpm", "frequency", "actions"],
        limit=1000,
        params={"time_increment": 1},
    )
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row.get("ad_id") or row.get("ad_name") or "unknown"].append(row)
    burnout: list[dict[str, Any]] = []
    for ad_id, items in grouped.items():
        items.sort(key=lambda x: x.get("date_start", ""))
        split_index = max(1, len(items) // 2)
        first = items[:split_index]
        last = items[split_index:]
        if not last:
            continue
        first_ctr = sum(_safe_float(x.get("ctr")) for x in first) / len(first)
        last_ctr = sum(_safe_float(x.get("ctr")) for x in last) / len(last)
        first_cpm = sum(_safe_float(x.get("cpm")) for x in first) / len(first)
        last_cpm = sum(_safe_float(x.get("cpm")) for x in last) / len(last)
        last_freq = sum(_safe_float(x.get("frequency")) for x in last) / len(last)
        if last_freq >= 2.5 and last_ctr < first_ctr and last_cpm > first_cpm:
            burnout.append(
                {
                    "ad_id": ad_id,
                    "ad_name": items[-1].get("ad_name"),
                    "frequency_recent": round(last_freq, 2),
                    "ctr_first_half": round(first_ctr, 4),
                    "ctr_second_half": round(last_ctr, 4),
                    "cpm_first_half": round(first_cpm, 2),
                    "cpm_second_half": round(last_cpm, 2),
                    "burnout_signal": "frequency_up_ctr_down_cpm_up",
                }
            )
    burnout.sort(key=lambda item: (item["frequency_recent"], item["cpm_second_half"] - item["cpm_first_half"]), reverse=True)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": burnout[:limit],
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def audit_meta_account(credentials: MetaAccountCredentials, end_date: str) -> dict[str, Any]:
    spend = fetch_meta_spend_overview(credentials, end_date)
    billing = fetch_meta_billing_summary(credentials)
    assets = fetch_meta_connected_assets(credentials)
    issues = fetch_meta_delivery_issues(credentials, limit=50)
    anomalies = detect_meta_anomalies(credentials, "campaign", end_date)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "summary": {
            "spend_overview": spend["periods"],
            "billing_model": "prepay" if billing["billing"]["is_prepay_account"] else "postpay",
            "balance_due": billing["billing"]["balance_due"],
            "asset_counts": assets["summary"],
            "issue_count": issues["issue_count"],
            "anomaly_count": len(anomalies["anomalies"]),
        },
        "details": {
            "issues": issues["issues"],
            "anomalies": anomalies["anomalies"],
        },
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def list_meta_lead_forms(credentials: MetaAccountCredentials, page_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    resolved_page_id = _pick_page_id(credentials, page_id)
    if not resolved_page_id:
        return {
            "provider": "meta_ads",
            "account_id": f"act_{credentials.account_id}",
            "page_id": None,
            "rows": [],
            "row_count": 0,
            "message": "No connected page found for lead forms lookup.",
            "source_api": "meta_marketing_api",
            "preview": False,
    }
    _init(credentials)
    fields = ["id", "name", "status", "locale", "created_time", "leads_count", "expired_leads_count", "organic_leads_count", "privacy_policy_url", "follow_up_action_url", "tracking_parameters"]
    try:
        cursor = Page(resolved_page_id).get_lead_gen_forms(fields=fields)
        rows = _rows(cursor, limit)
    except Exception as exc:
        if FacebookRequestError is not None and isinstance(exc, FacebookRequestError):
            return {
                "provider": "meta_ads",
                "account_id": f"act_{credentials.account_id}",
                "page_id": resolved_page_id,
                "rows": [],
                "row_count": 0,
                "message": "Lead forms require a Page Access Token or additional page permissions for this page.",
                "error": {
                    "type": exc.api_error_type(),
                    "code": exc.api_error_code(),
                    "message": exc.api_error_message(),
                },
                "source_api": "meta_marketing_api",
                "preview": False,
            }
        raise
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "page_id": resolved_page_id,
        "rows": rows,
        "row_count": len(rows),
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def get_meta_recommendations(credentials: MetaAccountCredentials, limit: int = 25, params: dict[str, Any] | None = None) -> dict[str, Any]:
    fields = ["title", "message", "importance", "confidence", "code", "value", "blame_field", "recommendation_data"]
    cursor = _account(credentials).get_recommendations(fields=fields, params=params or {})
    rows = _rows(cursor, limit)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": rows,
        "row_count": len(rows),
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def list_meta_automated_rules(credentials: MetaAccountCredentials, limit: int = 50) -> dict[str, Any]:
    fields = ["id", "name", "status", "created_time", "updated_time", "evaluation_spec", "execution_spec", "schedule_spec", "disable_error_code"]
    cursor = _account(credentials).get_ad_rules_library(fields=fields)
    rows = _rows(cursor, limit)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": rows,
        "row_count": len(rows),
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def get_meta_rule_history(credentials: MetaAccountCredentials, limit: int = 50) -> dict[str, Any]:
    cursor = _account(credentials).get_ad_rules_history(fields=["name", "evaluation_spec", "execution_spec", "schedule_spec", "status", "created_time", "updated_time"])
    rows = _rows(cursor, limit)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": rows,
        "row_count": len(rows),
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def get_meta_minimum_budgets(credentials: MetaAccountCredentials, params: dict[str, Any] | None = None) -> dict[str, Any]:
    cursor = _account(credentials).get_minimum_budgets(params=params or {})
    rows = _rows(cursor, 100)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": rows,
        "row_count": len(rows),
        "params": params or {},
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def get_meta_reach_estimate(credentials: MetaAccountCredentials, params: dict[str, Any]) -> dict[str, Any]:
    cursor = _account(credentials).get_reach_estimate(params=params)
    rows = _rows(cursor, 20)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "params": params,
        "rows": rows,
        "row_count": len(rows),
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def get_meta_tracking_specs(credentials: MetaAccountCredentials) -> dict[str, Any]:
    cursor = _account(credentials).get_tracking()
    rows = _rows(cursor, 100)
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": rows,
        "row_count": len(rows),
        "source_api": "meta_marketing_api",
        "preview": False,
    }


def audit_meta_links_and_utms(credentials: MetaAccountCredentials, limit: int = 100) -> dict[str, Any]:
    ads = fetch_meta_objects(credentials, "ad", fields=["id", "name", "creative", "preview_shareable_link", "status", "effective_status"], limit=limit)
    rows: list[dict[str, Any]] = []
    _init(credentials)
    for ad in ads["rows"]:
        creative_ref = ad.get("creative") or {}
        creative_id = creative_ref.get("id")
        creative_data: dict[str, Any] = {}
        if creative_id and AdCreative is not None:
            try:
                creative = AdCreative(creative_id).api_get(fields=["id", "name", "title", "body", "link_url", "object_url", "image_url", "video_id", "url_tags", "object_story_spec", "object_type", "thumbnail_url", "call_to_action_type"])
                creative_data = _export_value(dict(creative))
            except Exception as exc:
                creative_data = {"error": str(exc), "creative_id": creative_id}
        link_url = creative_data.get("link_url") or creative_data.get("object_url")
        rows.append(
            {
                "ad_id": ad.get("id"),
                "ad_name": ad.get("name"),
                "status": ad.get("effective_status") or ad.get("status"),
                "preview_shareable_link": ad.get("preview_shareable_link"),
                "creative_id": creative_id,
                "creative_name": creative_data.get("name"),
                "title": creative_data.get("title"),
                "body": creative_data.get("body"),
                "link_url": link_url,
                "url_tags": creative_data.get("url_tags"),
                "object_type": creative_data.get("object_type"),
                "image_url": creative_data.get("image_url"),
                "video_id": creative_data.get("video_id"),
                "thumbnail_url": creative_data.get("thumbnail_url"),
            }
        )
    return {
        "provider": "meta_ads",
        "account_id": f"act_{credentials.account_id}",
        "rows": rows,
        "row_count": len(rows),
        "source_api": "meta_marketing_api",
        "preview": False,
    }

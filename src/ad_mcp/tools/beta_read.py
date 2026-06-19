from __future__ import annotations

import re
from datetime import date
from typing import Any

from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.connection_store import (
    PROVIDER_NAMES,
    HostedConnectionStore,
    load_runtime_provider_configs,
    safe_account_summary,
)
from ad_mcp.core.models import DateRange, ReportRequest
from ad_mcp.core.policy import PolicyManager
from ad_mcp.runtime_context import current_workspace_id
from ad_mcp.settings import Settings
from ad_mcp.tools._shared import validate_provider_account


BASIC_METRIC_FIELDS = ["spend", "impressions", "clicks", "ctr", "conversions"]


def _refresh_runtime_connections(
    registry: CapabilityRegistry,
    settings: Settings,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    provider_configs, provider_sources = load_runtime_provider_configs(settings)
    for provider, config in provider_configs.items():
        registry.get_provider(provider).config = config
    return provider_configs, provider_sources


def _platforms(platform: str | None = None) -> list[str]:
    if platform:
        return [platform.strip()]
    return list(PROVIDER_NAMES)


def _redact_error(message: str, account_config: dict[str, Any] | None = None) -> str:
    redacted = str(message or "")
    candidates: list[str] = []
    if account_config:
        candidates.extend(str(value) for value in account_config.values() if isinstance(value, str))
        credentials = account_config.get("credentials")
        if isinstance(credentials, dict):
            candidates.extend(str(value) for value in credentials.values() if isinstance(value, str))
    for candidate in candidates:
        if len(candidate) >= 8 and candidate in redacted:
            redacted = redacted.replace(candidate, "[redacted]")
    return re.sub(r"(?i)(access_token|refresh_token|client_secret|app_secret|developer_token)=([^&\s]+)", r"\1=[redacted]", redacted)


def _account_by_id(provider_config: dict[str, Any], account_id: str) -> dict[str, Any] | None:
    requested = str(account_id or "").strip()
    for account in provider_config.get("accounts", []):
        configured = str(account.get("account_id") or account.get("customer_id") or account.get("advertiser_id") or "").strip()
        if configured == requested:
            return account
        if configured.startswith("act_") and configured[4:] == requested:
            return account
        if requested.startswith("act_") and requested[4:] == configured:
            return account
    return None


def _connection_status(account: dict[str, Any] | None) -> str:
    if not account:
        return "not_connected"
    status = str(account.get("status") or "").strip().lower()
    if status in {"expired", "reconnect_required", "error"}:
        return status
    if not safe_account_summary(account).get("credentials_present"):
        return "reconnect_required"
    return "active"


def _not_available(
    *,
    platform: str,
    account_id: str | None = None,
    message: str,
    source_api: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "not_available",
        "data_status": "not_available",
        "platform": platform,
        "account_id": account_id,
        "message": message,
        "real_data": False,
    }
    if source_api:
        payload["source_api"] = source_api
    if extra:
        payload.update(extra)
    return payload


def _normalize_campaign(platform: str, row: dict[str, Any]) -> dict[str, Any]:
    campaign_id = row.get("id") or row.get("campaign_id")
    provider_status = row.get("effective_status") or row.get("status")
    normalized: dict[str, Any] = {
        "platform": platform,
        "campaign_id": str(campaign_id) if campaign_id is not None else None,
        "name": row.get("name") or row.get("campaign_name"),
        "status": str(provider_status).lower() if provider_status is not None else None,
        "provider_status": provider_status,
        "objective": row.get("objective") or row.get("advertising_channel_type"),
        "created_time": row.get("created_time"),
        "updated_time": row.get("updated_time"),
        "start_date": row.get("start_time") or row.get("start_date"),
        "end_date": row.get("stop_time") or row.get("end_time"),
        "currency": row.get("currency"),
    }
    if platform == "meta_ads":
        normalized.update(
            {
                "daily_budget_minor_units": row.get("daily_budget"),
                "lifetime_budget_minor_units": row.get("lifetime_budget"),
                "budget_remaining_minor_units": row.get("budget_remaining"),
                "spend_cap_minor_units": row.get("spend_cap"),
            }
        )
    else:
        normalized.update(
            {
                "daily_budget": row.get("daily_budget"),
                "daily_budget_micros": row.get("daily_budget_micros"),
                "budget_delivery_method": row.get("budget_delivery_method"),
            }
        )
    return {key: value for key, value in normalized.items() if value is not None}


def _safe_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    number = _safe_float(value)
    return int(number) if number is not None else None


def _extract_conversions(row: dict[str, Any]) -> float | None:
    value = row.get("conversions")
    if isinstance(value, list):
        total = 0.0
        found = False
        for item in value:
            if isinstance(item, dict):
                item_value = _safe_float(item.get("value"))
                if item_value is not None:
                    total += item_value
                    found = True
        return total if found else None
    return _safe_float(value)


def _normalize_metric_row(platform: str, account_id: str, row: dict[str, Any]) -> dict[str, Any]:
    spend = _safe_float(row.get("spend"))
    impressions = _safe_int(row.get("impressions"))
    clicks = _safe_int(row.get("clicks") if row.get("clicks") not in (None, "") else row.get("inline_link_clicks"))
    conversions = _extract_conversions(row)
    ctr = (clicks / impressions * 100) if clicks is not None and impressions else _safe_float(row.get("ctr"))
    cpc = (spend / clicks) if spend is not None and clicks else _safe_float(row.get("cpc"))
    cpm = (spend * 1000 / impressions) if spend is not None and impressions else _safe_float(row.get("cpm"))
    cost_per_conversion = (spend / conversions) if spend is not None and conversions else None
    normalized: dict[str, Any] = {
        "platform": platform,
        "account_id": str(row.get("account_id") or account_id),
        "date": row.get("date") or row.get("date_start"),
        "date_stop": row.get("date_stop"),
        "campaign_id": row.get("campaign_id"),
        "campaign_name": row.get("campaign_name") or row.get("campaign"),
        "spend": spend,
        "impressions": impressions,
        "clicks": clicks,
        "ctr": ctr,
        "cpc": cpc,
        "cpm": cpm,
        "conversions": conversions,
        "cost_per_conversion": cost_per_conversion,
    }
    return {key: value for key, value in normalized.items() if value is not None}


def _metric_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    spend = sum(row.get("spend") or 0 for row in rows)
    impressions = sum(row.get("impressions") or 0 for row in rows)
    clicks = sum(row.get("clicks") or 0 for row in rows)
    conversion_values = [row.get("conversions") for row in rows if row.get("conversions") is not None]
    conversions = sum(conversion_values) if conversion_values else None
    return {
        "spend": spend,
        "impressions": impressions,
        "clicks": clicks,
        "ctr": (clicks / impressions * 100) if impressions else None,
        "cpc": (spend / clicks) if clicks else None,
        "cpm": (spend * 1000 / impressions) if impressions else None,
        "conversions": conversions,
        "cost_per_conversion": (spend / conversions) if conversions else None,
    }


def build_beta_read_tools(
    registry: CapabilityRegistry,
    policy_manager: PolicyManager,
    settings: Settings,
) -> dict[str, callable]:
    store = HostedConnectionStore(settings.connection_store_file)

    def list_connected_platforms() -> dict:
        provider_configs, provider_sources = _refresh_runtime_connections(registry, settings)
        workspace_id = current_workspace_id()
        platforms: list[dict[str, Any]] = []
        for provider in PROVIDER_NAMES:
            accounts = provider_configs.get(provider, {}).get("accounts", [])
            capabilities = registry.get_capabilities(provider)
            pending = store.pending_selections(provider, workspace_id=workspace_id)
            platforms.append(
                {
                    "platform": provider,
                    "status": "connected" if accounts else ("pending_account_selection" if pending else "not_connected"),
                    "connected": bool(accounts),
                    "account_count": len(accounts),
                    "source": provider_sources.get(provider, "empty"),
                    "accounts": [safe_account_summary(account) for account in accounts],
                    "pending_selection_count": len(pending),
                    "read_objects": capabilities.read_objects,
                    "metrics_supported": provider in {"meta_ads", "google_ads"},
                    "campaigns_supported": provider in {"meta_ads", "google_ads"},
                }
            )
        return {"status": "ok", "platforms": platforms}

    def list_ad_accounts(platform: str | None = None) -> dict:
        provider_configs, provider_sources = _refresh_runtime_connections(registry, settings)
        accounts: list[dict[str, Any]] = []
        for provider in _platforms(platform):
            config = provider_configs.get(provider, {"accounts": []})
            for account in config.get("accounts", []):
                summary = safe_account_summary(account)
                summary["platform"] = provider
                summary["connection_status"] = _connection_status(account)
                summary["source"] = provider_sources.get(provider, "empty")
                accounts.append(summary)
        return {
            "status": "ok",
            "platform": platform,
            "account_count": len(accounts),
            "accounts": accounts,
        }

    def get_account_status(platform: str, account_id: str) -> dict:
        provider_configs, provider_sources = _refresh_runtime_connections(registry, settings)
        account = _account_by_id(provider_configs.get(platform, {}), account_id)
        summary = safe_account_summary(account or {})
        return {
            "status": _connection_status(account),
            "platform": platform,
            "account_id": account_id,
            "source": provider_sources.get(platform, "empty"),
            "credentials_present": bool(summary.get("credentials_present")),
            "account": summary if account else None,
        }

    def run_connection_diagnostics(platform: str | None = None, account_id: str | None = None, live_check: bool = False) -> dict:
        provider_configs, provider_sources = _refresh_runtime_connections(registry, settings)
        checks: list[dict[str, Any]] = []
        for provider in _platforms(platform):
            config = provider_configs.get(provider, {"accounts": []})
            selected_accounts = config.get("accounts", [])
            if account_id:
                selected_accounts = [account for account in selected_accounts if _account_by_id({"accounts": [account]}, account_id)]
            if not selected_accounts:
                checks.append(
                    {
                        "platform": provider,
                        "account_id": account_id,
                        "status": "not_connected",
                        "source": provider_sources.get(provider, "empty"),
                        "credentials_present": False,
                        "api_access": "not_checked",
                        "message": "No connected account found for this platform/account.",
                    }
                )
                continue
            for account in selected_accounts:
                resolved_account_id = str(account.get("account_id") or account.get("customer_id") or account.get("advertiser_id") or "")
                connection_status = _connection_status(account)
                check: dict[str, Any] = {
                    "platform": provider,
                    "account_id": resolved_account_id,
                    "status": connection_status,
                    "source": provider_sources.get(provider, "empty"),
                    "credentials_present": bool(safe_account_summary(account).get("credentials_present")),
                    "selected_account": safe_account_summary(account),
                    "api_access": "not_checked",
                }
                if live_check and connection_status == "active":
                    try:
                        validate_provider_account(registry, policy_manager, provider, resolved_account_id)
                        summary = registry.get_provider(provider).get_account_summary(resolved_account_id)
                        unsupported = summary.get("status") == "unsupported"
                        check["api_access"] = "not_available" if unsupported else "ok"
                        check["live_check"] = "account_summary"
                        check["message"] = summary.get("message") if unsupported else "Provider API responded."
                    except Exception as exc:  # noqa: BLE001 - MCP diagnostics must return structured errors.
                        check["status"] = "error"
                        check["api_access"] = "error"
                        check["error"] = _redact_error(str(exc), account)
                checks.append(check)
        return {
            "status": "ok",
            "live_check": live_check,
            "checks": checks,
        }

    def list_campaigns(
        platform: str,
        account_id: str,
        limit: int = 100,
        status: str | None = None,
    ) -> dict:
        _refresh_runtime_connections(registry, settings)
        provider_client = registry.get_provider(platform)
        try:
            account_config = validate_provider_account(registry, policy_manager, platform, account_id)
        except Exception as exc:  # noqa: BLE001
            return _not_available(
                platform=platform,
                account_id=account_id,
                message=_redact_error(str(exc)),
                source_api=provider_client.source_api,
            )
        params = {"status": status} if status else {}
        if platform == "meta_ads" and status:
            params = {"effective_status": [status.upper()]}
        try:
            payload = provider_client.list_account_objects(account_id, "campaign", params=params, limit=limit)
        except Exception as exc:  # noqa: BLE001
            return _not_available(
                platform=platform,
                account_id=account_id,
                message=_redact_error(str(exc), account_config),
                source_api=provider_client.source_api,
            )
        if payload.get("status") == "unsupported":
            return _not_available(
                platform=platform,
                account_id=account_id,
                message=payload.get("message", "Campaign listing is not implemented for this platform yet."),
                source_api=provider_client.source_api,
            )
        rows = [_normalize_campaign(platform, row) for row in payload.get("rows", [])]
        return {
            "status": "ok",
            "data_status": "real",
            "real_data": True,
            "platform": platform,
            "account_id": account_id,
            "limit": payload.get("limit", limit),
            "status_filter": status,
            "row_count": len(rows),
            "campaigns": rows,
            "source_api": payload.get("source_api", provider_client.source_api),
        }

    def get_campaign(platform: str, account_id: str, campaign_id: str) -> dict:
        _refresh_runtime_connections(registry, settings)
        provider_client = registry.get_provider(platform)
        try:
            account_config = validate_provider_account(registry, policy_manager, platform, account_id)
        except Exception as exc:  # noqa: BLE001
            return _not_available(
                platform=platform,
                account_id=account_id,
                message=_redact_error(str(exc)),
                source_api=provider_client.source_api,
                extra={"campaign_id": campaign_id},
            )
        try:
            payload = provider_client.get_account_object(account_id, "campaign", campaign_id)
        except Exception as exc:  # noqa: BLE001
            return _not_available(
                platform=platform,
                account_id=account_id,
                message=_redact_error(str(exc), account_config),
                source_api=provider_client.source_api,
                extra={"campaign_id": campaign_id},
            )
        if payload.get("status") == "unsupported":
            return _not_available(
                platform=platform,
                account_id=account_id,
                message=payload.get("message", "Campaign retrieval is not implemented for this platform yet."),
                source_api=provider_client.source_api,
                extra={"campaign_id": campaign_id},
            )
        data = payload.get("data")
        return {
            "status": payload.get("status", "ok") if data else "not_found",
            "data_status": "real" if data else "not_found",
            "real_data": bool(data),
            "platform": platform,
            "account_id": account_id,
            "campaign_id": campaign_id,
            "campaign": _normalize_campaign(platform, data) if isinstance(data, dict) else None,
            "source_api": payload.get("source_api", provider_client.source_api),
        }

    def get_campaign_statuses(
        platform: str,
        account_id: str,
        limit: int = 500,
    ) -> dict:
        payload = list_campaigns(platform=platform, account_id=account_id, limit=limit)
        if payload.get("status") != "ok":
            return payload
        counts: dict[str, int] = {}
        rows: list[dict[str, Any]] = []
        for campaign in payload.get("campaigns", []):
            provider_status = campaign.get("provider_status") or campaign.get("status") or "unknown"
            normalized_status = str(campaign.get("status") or provider_status).lower()
            counts[normalized_status] = counts.get(normalized_status, 0) + 1
            rows.append(
                {
                    "campaign_id": campaign.get("campaign_id"),
                    "name": campaign.get("name"),
                    "status": normalized_status,
                    "provider_status": provider_status,
                }
            )
        return {
            "status": "ok",
            "data_status": "real",
            "real_data": True,
            "platform": platform,
            "account_id": account_id,
            "row_count": len(rows),
            "status_counts": counts,
            "campaigns": rows,
            "source_api": payload.get("source_api"),
        }

    def get_basic_metrics(
        platform: str,
        account_id: str,
        date_from: str,
        date_to: str,
        level: str = "account",
        campaign_id: str | None = None,
        limit: int = 500,
        status: str | None = None,
    ) -> dict:
        date.fromisoformat(date_from)
        date.fromisoformat(date_to)
        policy_manager.validate_report_range(date_from, date_to)
        _refresh_runtime_connections(registry, settings)
        provider_client = registry.get_provider(platform)
        try:
            account_config = validate_provider_account(registry, policy_manager, platform, account_id)
        except Exception as exc:  # noqa: BLE001
            return _not_available(
                platform=platform,
                account_id=account_id,
                message=_redact_error(str(exc)),
                source_api=provider_client.source_api,
                extra={"date_range": {"date_from": date_from, "date_to": date_to}},
            )
        if platform == "meta_ads":
            fields = [
                "date_start",
                "date_stop",
                "account_id",
                "account_name",
                "reach",
                "impressions",
                "clicks",
                "inline_link_clicks",
                "spend",
                "ctr",
                "cpc",
                "cpm",
                "conversions",
            ]
            if level == "campaign" or campaign_id:
                fields.extend(["campaign_id", "campaign_name"])
            params: dict[str, Any] = {}
            if campaign_id:
                params["filtering"] = [{"field": "campaign.id", "operator": "IN", "value": [campaign_id]}]
                level = "campaign"
            try:
                payload = provider_client.get_flexible_insights(
                    account_id=account_id,
                    level=level,
                    start_date=date_from,
                    end_date=date_to,
                    fields=fields,
                    params=params,
                    limit=limit,
                )
            except Exception as exc:  # noqa: BLE001
                return _not_available(
                    platform=platform,
                    account_id=account_id,
                    message=_redact_error(str(exc), account_config),
                    source_api=provider_client.source_api,
                )
            if payload.get("status") == "unsupported":
                return _not_available(
                    platform=platform,
                    account_id=account_id,
                    message=payload.get("message", "Metrics are not implemented for this platform yet."),
                    source_api=provider_client.source_api,
                )
            raw_rows = payload.get("rows", [])
            source_api = payload.get("source_api", provider_client.source_api)
        else:
            request = ReportRequest(
                provider=platform,  # type: ignore[arg-type]
                account_id=account_id,
                entity_level=level,
                date_range=DateRange(start_date=date_from, end_date=date_to),
                fields=BASIC_METRIC_FIELDS,
                filters={key: value for key, value in {"campaign_id": campaign_id, "status": status}.items() if value},
            )
            try:
                response = provider_client.get_report(request)
            except Exception as exc:  # noqa: BLE001
                return _not_available(
                    platform=platform,
                    account_id=account_id,
                    message=_redact_error(str(exc), account_config),
                    source_api=provider_client.source_api,
                )
            if response.preview:
                return _not_available(
                    platform=platform,
                    account_id=account_id,
                    message="Real metrics are not available for this platform in the current beta build.",
                    source_api=response.source_api,
                    extra={
                        "level": level,
                        "date_range": {"date_from": date_from, "date_to": date_to},
                        "unsupported_requested_fields": response.unsupported_requested_fields,
                    },
                )
            raw_rows = response.rows
            source_api = response.source_api
        rows = [_normalize_metric_row(platform, account_id, row) for row in raw_rows[: max(1, min(int(limit or 500), 1000))]]
        currency = account_config.get("currency") or account_config.get("currency_code")
        return {
            "status": "ok",
            "data_status": "real",
            "real_data": True,
            "platform": platform,
            "account_id": account_id,
            "level": level,
            "campaign_id": campaign_id,
            "date_range": {"date_from": date_from, "date_to": date_to},
            "currency": currency,
            "rate_basis": "percent",
            "metrics": ["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "conversions", "cost_per_conversion"],
            "totals": _metric_totals(rows),
            "row_count": len(rows),
            "rows": rows,
            "source_api": source_api,
        }

    return {
        "list_connected_platforms": list_connected_platforms,
        "list_ad_accounts": list_ad_accounts,
        "get_account_status": get_account_status,
        "run_connection_diagnostics": run_connection_diagnostics,
        "list_campaigns": list_campaigns,
        "get_campaign": get_campaign,
        "get_campaign_statuses": get_campaign_statuses,
        "get_basic_metrics": get_basic_metrics,
    }

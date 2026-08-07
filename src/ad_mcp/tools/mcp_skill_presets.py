from __future__ import annotations

from datetime import date, timedelta

from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.meta_skill_presets import (
    build_budget_skill_summary,
    build_disable_candidates_skill,
    build_report_skill,
    build_scale_candidates_skill,
    build_skill_catalog,
)
from ad_mcp.reporting.monthly_ads import collect_monthly_ads_report
from ad_mcp.core.policy import PolicyManager
from ad_mcp.tools._shared import validate_provider_account


def build_mcp_skill_preset_tools(
    registry: CapabilityRegistry,
    policy_manager: PolicyManager,
) -> dict[str, callable]:
    def _date_window(end_date: str | None = None, lookback_days: int = 7) -> tuple[str, str]:
        resolved_end = date.fromisoformat(end_date) if end_date else date.today()
        resolved_start = resolved_end - timedelta(days=max(lookback_days - 1, 0))
        start_date = resolved_start.isoformat()
        end_date_iso = resolved_end.isoformat()
        policy_manager.validate_report_range(start_date, end_date_iso)
        return start_date, end_date_iso

    def list_operator_skills(provider: str, account_id: str, end_date: str | None = None) -> dict:
        account = validate_provider_account(registry, policy_manager, provider, account_id)
        return {
            "provider": provider,
            "account_id": account_id,
            "skills": build_skill_catalog(account_id, end_date, provider=provider),
            "preview": False,
        }

    def summarize_budget_skill(provider: str, account_id: str, end_date: str) -> dict:
        validate_provider_account(registry, policy_manager, provider, account_id)
        provider_client = registry.get_provider(provider)
        spend = provider_client.get_spend_overview(account_id, end_date)
        billing = provider_client.get_billing_summary(account_id)
        result = build_budget_skill_summary(account_id, end_date, spend, billing)
        result["provider"] = provider
        result["preview"] = False
        return result

    def disable_candidates_skill(
        provider: str,
        account_id: str,
        end_date: str,
        lookback_days: int = 7,
        entity_level: str = "ad",
        min_spend: float = 20.0,
        limit: int = 10,
    ) -> dict:
        validate_provider_account(registry, policy_manager, provider, account_id)
        provider_client = registry.get_provider(provider)
        start_date, end_date_iso = _date_window(end_date, lookback_days)
        issues = provider_client.get_delivery_issues(account_id, max(limit * 2, 20))
        ranked = provider_client.rank_top_entities(account_id, entity_level, start_date, end_date_iso, "spend", 300)
        no_result = {
            "rows": [
                row
                for row in ranked.get("rows", [])
                if float(row.get("spend", 0) or 0) >= min_spend and float(row.get("conversions", 0) or 0) == 0
            ],
        }
        result = build_disable_candidates_skill(
            account_id,
            start_date,
            end_date_iso,
            issues,
            no_result,
            min_spend,
            max_items=limit,
        )
        result["provider"] = provider
        result["preview"] = False
        return result

    def scale_candidates_skill(
        provider: str,
        account_id: str,
        end_date: str,
        lookback_days: int = 7,
        entity_level: str = "campaign",
        max_cost_per_result: float = 20.0,
        min_conversions: float = 1.0,
        limit: int = 10,
    ) -> dict:
        validate_provider_account(registry, policy_manager, provider, account_id)
        provider_client = registry.get_provider(provider)
        start_date, end_date_iso = _date_window(end_date, lookback_days)
        top = provider_client.rank_top_entities(account_id, entity_level, start_date, end_date_iso, "cost_per_result", max(limit * 3, 20))
        result = build_scale_candidates_skill(
            account_id,
            start_date,
            end_date_iso,
            top,
            max_cost_per_result=max_cost_per_result,
            min_conversions=min_conversions,
            max_items=limit,
        )
        result["provider"] = provider
        result["preview"] = False
        return result

    def collect_report_skill(
        provider: str,
        account_id: str,
        end_date: str,
        lookback_days: int = 30,
        entity_level: str = "campaign",
        min_spend: float = 20.0,
        max_cost_per_result: float = 20.0,
    ) -> dict:
        account = validate_provider_account(registry, policy_manager, provider, account_id)
        provider_client = registry.get_provider(provider)
        start_date, end_date_iso = _date_window(end_date, lookback_days)
        budget = summarize_budget_skill(provider, account_id, end_date_iso)
        disable = disable_candidates_skill(
            provider=provider,
            account_id=account_id,
            end_date=end_date_iso,
            lookback_days=lookback_days,
            entity_level="ad",
            min_spend=min_spend,
            limit=10,
        )
        scale = scale_candidates_skill(
            provider=provider,
            account_id=account_id,
            end_date=end_date_iso,
            lookback_days=lookback_days,
            entity_level=entity_level,
            max_cost_per_result=max_cost_per_result,
            min_conversions=1.0,
            limit=10,
        )
        issues = provider_client.get_delivery_issues(account_id, 20)
        result = build_report_skill(account_id, end_date_iso, budget, disable, scale, issues)
        result["monthly_report"] = collect_monthly_ads_report(
            provider_client,
            provider=provider,
            account_id=account_id,
            start_date=start_date,
            end_date=end_date_iso,
            timezone_name=str(account.get("timezone") or "UTC"),
            account_name=str(account.get("name") or account_id),
            currency=str(account.get("currency") or account.get("currency_code") or "USD"),
        )
        result["provider"] = provider
        result["preview"] = False
        result["period"] = {"start_date": start_date, "end_date": end_date_iso}
        return result

    return {
        "list_operator_skills": list_operator_skills,
        "summarize_budget_skill": summarize_budget_skill,
        "disable_candidates_skill": disable_candidates_skill,
        "scale_candidates_skill": scale_candidates_skill,
        "collect_report_skill": collect_report_skill,
    }

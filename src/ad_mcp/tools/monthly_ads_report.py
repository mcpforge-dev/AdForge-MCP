from __future__ import annotations

from datetime import date
from typing import Any

from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.policy import PolicyManager
from ad_mcp.reporting.monthly_ads import collect_monthly_ads_report
from ad_mcp.tools._shared import validate_provider_account


def build_monthly_ads_report_tools(
    registry: CapabilityRegistry,
    policy_manager: PolicyManager,
) -> dict[str, callable]:
    def generate_monthly_ads_report(
        provider: str,
        account_id: str,
        start_date: str,
        end_date: str,
        timezone_name: str = "UTC",
        include_previous: bool = True,
    ) -> dict[str, Any]:
        """Build a read-only evidence-based report for one connected account."""
        account = validate_provider_account(registry, policy_manager, provider, account_id)
        policy_manager.validate_report_range(start_date, end_date)
        provider_client = registry.get_provider(provider)
        return collect_monthly_ads_report(
            provider_client,
            provider=provider,
            account_id=account_id,
            start_date=start_date,
            end_date=end_date,
            timezone_name=timezone_name,
            account_name=str(account.get("name") or account_id),
            currency=str(account.get("currency") or account.get("currency_code") or "USD"),
            include_previous=include_previous,
        )

    return {"generate_monthly_ads_report": generate_monthly_ads_report}

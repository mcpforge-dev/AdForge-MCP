from __future__ import annotations

from ad_mcp.core.models import CapabilityMap, ReportRequest, ReportResponse
from ad_mcp.providers.base.client import BaseAdsProvider
from ad_mcp.providers.meta_ads.account_read import (
    fetch_meta_account_summary,
    fetch_meta_flexible_insights,
    fetch_meta_object,
    fetch_meta_objects,
    search_meta_targeting,
)
from ad_mcp.providers.meta_ads.analysis import (
    analyze_meta_audiences,
    audit_meta_account,
    audit_meta_links_and_utms,
    compare_meta_periods,
    detect_meta_anomalies,
    estimate_meta_budget_days_remaining,
    fetch_meta_connected_assets,
    fetch_meta_delivery_issues,
    fetch_meta_spend_overview,
    find_meta_burnout_ads,
    get_meta_minimum_budgets,
    get_meta_reach_estimate,
    get_meta_recommendations,
    get_meta_rule_history,
    get_meta_tracking_specs,
    list_meta_automated_rules,
    list_meta_lead_forms,
    rank_meta_entities,
)
from ad_mcp.providers.meta_ads.auth import (
    credentials_from_config,
    normalize_meta_account_id,
)
from ad_mcp.providers.meta_ads.billing import fetch_meta_billing_summary
from ad_mcp.providers.meta_ads.graph_read import (
    get_meta_business as graph_get_meta_business,
)
from ad_mcp.providers.meta_ads.graph_read import (
    get_meta_page as graph_get_meta_page,
)
from ad_mcp.providers.meta_ads.graph_read import (
    get_page_instagram_account as graph_get_page_instagram_account,
)
from ad_mcp.providers.meta_ads.graph_read import (
    get_page_post as graph_get_page_post,
)
from ad_mcp.providers.meta_ads.graph_read import (
    get_page_post_engagement as graph_get_page_post_engagement,
)
from ad_mcp.providers.meta_ads.graph_read import (
    list_business_ad_accounts as graph_list_business_ad_accounts,
)
from ad_mcp.providers.meta_ads.graph_read import (
    list_business_pages as graph_list_business_pages,
)
from ad_mcp.providers.meta_ads.graph_read import (
    list_meta_businesses as graph_list_meta_businesses,
)
from ad_mcp.providers.meta_ads.graph_read import (
    list_meta_pages as graph_list_meta_pages,
)
from ad_mcp.providers.meta_ads.graph_read import (
    list_meta_permissions as graph_list_meta_permissions,
)
from ad_mcp.providers.meta_ads.graph_read import (
    list_page_posts as graph_list_page_posts,
)
from ad_mcp.providers.meta_ads.mutations import (
    commit_meta_app_review_preview,
    commit_meta_confirmed_write,
)
from ad_mcp.providers.meta_ads.payloads import build_meta_ads_payload
from ad_mcp.providers.meta_ads.reporting import fetch_meta_report


class MetaAdsProvider(BaseAdsProvider):
    def __init__(self, config: dict | None = None) -> None:
        super().__init__(
            capabilities=CapabilityMap(
                provider="meta_ads",
                read_objects=[
                    "account",
                    "campaign",
                    "adset",
                    "ad",
                    "creative",
                    "audience",
                    "saved_audience",
                    "pixel",
                    "custom_conversion",
                    "ad_image",
                    "ad_video",
                    "instagram_account",
                    "page",
                    "activity",
                    "user",
                ],
                write_objects=["campaign", "adset", "ad", "creative", "audience", "schedule"],
                supported_metrics=[
                    "reach",
                    "impressions",
                    "interactions",
                    "clicks",
                    "spend",
                    "ctr",
                    "cr",
                    "conversions",
                ],
                supported_dimensions=["date", "campaign", "adset", "ad", "placement", "device_platform"],
                supported_campaign_types=["awareness", "traffic", "engagement", "leads", "sales", "app_promotion"],
                supported_audience_types=["saved", "custom", "lookalike"],
                notes=[
                    "Seeded from local reports-holymedia Meta scripts.",
                    "Real creative and audience creation still needs provider-native translators.",
                ],
            ),
            source_api="meta_marketing_api",
            config=config,
        )

    def get_account_config(self, account_id: str) -> dict:
        requested_id = str(account_id or "").strip()
        normalized_requested_id = normalize_meta_account_id(requested_id)
        for item in self.config.get("accounts", []):
            configured_id = str(item.get("account_id", "")).strip()
            if configured_id == requested_id:
                return item
            if normalize_meta_account_id(configured_id) == normalized_requested_id:
                return item
        return {}

    def _credentials(self, account_id: str):
        account_config = self.get_account_config(account_id)
        if not account_config:
            raise ValueError("Meta account is not configured in the current workspace.")
        return credentials_from_config(account_config)

    def list_meta_permissions(self, account_id: str) -> dict:
        return graph_list_meta_permissions(self._credentials(account_id))

    def list_meta_businesses(self, account_id: str, limit: int = 100) -> dict:
        return graph_list_meta_businesses(self._credentials(account_id), limit)

    def get_meta_business(self, account_id: str, business_id: str) -> dict:
        return graph_get_meta_business(self._credentials(account_id), business_id)

    def list_business_ad_accounts(self, account_id: str, business_id: str, limit: int = 100) -> dict:
        return graph_list_business_ad_accounts(self._credentials(account_id), business_id, limit)

    def list_business_pages(self, account_id: str, business_id: str, limit: int = 100) -> dict:
        return graph_list_business_pages(self._credentials(account_id), business_id, limit)

    def list_meta_pages(self, account_id: str, limit: int = 100) -> dict:
        return graph_list_meta_pages(self._credentials(account_id), limit)

    def get_meta_page(self, account_id: str, page_id: str) -> dict:
        return graph_get_meta_page(self._credentials(account_id), page_id)

    def list_page_posts(self, account_id: str, page_id: str, limit: int = 25) -> dict:
        return graph_list_page_posts(self._credentials(account_id), page_id, limit)

    def get_page_post(self, account_id: str, page_id: str, post_id: str) -> dict:
        return graph_get_page_post(self._credentials(account_id), page_id, post_id)

    def get_page_post_engagement(self, account_id: str, page_id: str, post_id: str) -> dict:
        return graph_get_page_post_engagement(self._credentials(account_id), page_id, post_id)

    def get_page_instagram_account(self, account_id: str, page_id: str) -> dict:
        return graph_get_page_instagram_account(self._credentials(account_id), page_id)

    def commit_app_review_preview(self, preview):
        return commit_meta_app_review_preview(self._credentials(preview.account_id), preview)

    def commit_confirmed_write(self, preview, *, require_paused_objects: bool = True):
        return commit_meta_confirmed_write(
            self._credentials(preview.account_id),
            preview,
            require_paused_objects=require_paused_objects,
        )

    def get_report(self, request: ReportRequest) -> ReportResponse:
        account_config = self.get_account_config(request.account_id)
        if not account_config:
            return super().get_report(request)
        credentials = credentials_from_config(account_config)
        return fetch_meta_report(credentials, request, self.capabilities.supported_metrics)

    def get_billing_summary(self, account_id: str) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_billing_summary(account_id)
        credentials = credentials_from_config(account_config)
        return fetch_meta_billing_summary(credentials)

    def get_account_summary(self, account_id: str, fields: list[str] | None = None) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_account_summary(account_id, fields)
        credentials = credentials_from_config(account_config)
        return fetch_meta_account_summary(credentials, fields)

    def list_account_objects(
        self,
        account_id: str,
        object_type: str,
        fields: list[str] | None = None,
        params: dict | None = None,
        limit: int = 100,
    ) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().list_account_objects(account_id, object_type, fields, params, limit)
        credentials = credentials_from_config(account_config)
        return fetch_meta_objects(credentials, object_type, fields, params, limit)

    def get_account_object(
        self,
        account_id: str,
        object_type: str,
        object_id: str,
        fields: list[str] | None = None,
    ) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_account_object(account_id, object_type, object_id, fields)
        credentials = credentials_from_config(account_config)
        return fetch_meta_object(credentials, object_type, object_id, fields)

    def get_flexible_insights(
        self,
        account_id: str,
        level: str,
        start_date: str,
        end_date: str,
        fields: list[str] | None = None,
        breakdowns: list[str] | None = None,
        params: dict | None = None,
        limit: int = 500,
    ) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_flexible_insights(account_id, level, start_date, end_date, fields, breakdowns, params, limit)
        credentials = credentials_from_config(account_config)
        return fetch_meta_flexible_insights(credentials, level, start_date, end_date, fields, breakdowns, params, limit)

    def search_targeting(
        self,
        account_id: str,
        query: str,
        targeting_type: str,
        limit: int = 25,
    ) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().search_targeting(account_id, query, targeting_type, limit)
        credentials = credentials_from_config(account_config)
        return search_meta_targeting(credentials, query, targeting_type, limit)

    def get_spend_overview(self, account_id: str, end_date: str) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_spend_overview(account_id, end_date)
        credentials = credentials_from_config(account_config)
        return fetch_meta_spend_overview(credentials, end_date)

    def estimate_budget_days_remaining(self, account_id: str, end_date: str, lookback_days: int = 7) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().estimate_budget_days_remaining(account_id, end_date, lookback_days)
        credentials = credentials_from_config(account_config)
        return estimate_meta_budget_days_remaining(credentials, end_date, lookback_days)

    def get_connected_assets(self, account_id: str) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_connected_assets(account_id)
        credentials = credentials_from_config(account_config)
        return fetch_meta_connected_assets(credentials)

    def get_delivery_issues(self, account_id: str, limit: int = 100) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_delivery_issues(account_id, limit)
        credentials = credentials_from_config(account_config)
        return fetch_meta_delivery_issues(credentials, limit)

    def rank_top_entities(
        self,
        account_id: str,
        entity_level: str,
        start_date: str,
        end_date: str,
        metric: str,
        limit: int = 5,
    ) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().rank_top_entities(account_id, entity_level, start_date, end_date, metric, limit)
        credentials = credentials_from_config(account_config)
        return rank_meta_entities(credentials, entity_level, start_date, end_date, metric, limit)

    def compare_periods(
        self,
        account_id: str,
        entity_level: str,
        start_date_a: str,
        end_date_a: str,
        start_date_b: str,
        end_date_b: str,
    ) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().compare_periods(account_id, entity_level, start_date_a, end_date_a, start_date_b, end_date_b)
        credentials = credentials_from_config(account_config)
        return compare_meta_periods(credentials, entity_level, start_date_a, end_date_a, start_date_b, end_date_b)

    def detect_anomalies(self, account_id: str, entity_level: str, end_date: str, lookback_days: int = 7) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().detect_anomalies(account_id, entity_level, end_date, lookback_days)
        credentials = credentials_from_config(account_config)
        return detect_meta_anomalies(credentials, entity_level, end_date, lookback_days)

    def analyze_audiences(self, account_id: str, start_date: str, end_date: str, limit: int = 20) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().analyze_audiences(account_id, start_date, end_date, limit)
        credentials = credentials_from_config(account_config)
        return analyze_meta_audiences(credentials, start_date, end_date, limit)

    def find_burnout_ads(self, account_id: str, start_date: str, end_date: str, limit: int = 20) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().find_burnout_ads(account_id, start_date, end_date, limit)
        credentials = credentials_from_config(account_config)
        return find_meta_burnout_ads(credentials, start_date, end_date, limit)

    def audit_account(self, account_id: str, end_date: str) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().audit_account(account_id, end_date)
        credentials = credentials_from_config(account_config)
        return audit_meta_account(credentials, end_date)

    def list_lead_forms(self, account_id: str, page_id: str | None = None, limit: int = 50) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().list_lead_forms(account_id, page_id, limit)
        credentials = credentials_from_config(account_config)
        return list_meta_lead_forms(credentials, page_id, limit)

    def get_recommendations_read(self, account_id: str, limit: int = 25, params: dict | None = None) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_recommendations_read(account_id, limit, params)
        credentials = credentials_from_config(account_config)
        return get_meta_recommendations(credentials, limit, params)

    def list_automated_rules(self, account_id: str, limit: int = 50) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().list_automated_rules(account_id, limit)
        credentials = credentials_from_config(account_config)
        return list_meta_automated_rules(credentials, limit)

    def get_rule_history(self, account_id: str, limit: int = 50) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_rule_history(account_id, limit)
        credentials = credentials_from_config(account_config)
        return get_meta_rule_history(credentials, limit)

    def get_minimum_budgets_read(self, account_id: str, params: dict | None = None) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_minimum_budgets_read(account_id, params)
        credentials = credentials_from_config(account_config)
        return get_meta_minimum_budgets(credentials, params)

    def get_reach_estimate_read(self, account_id: str, params: dict) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_reach_estimate_read(account_id, params)
        credentials = credentials_from_config(account_config)
        return get_meta_reach_estimate(credentials, params)

    def get_tracking_specs(self, account_id: str) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().get_tracking_specs(account_id)
        credentials = credentials_from_config(account_config)
        return get_meta_tracking_specs(credentials)

    def audit_links_and_utms(self, account_id: str, limit: int = 100) -> dict:
        account_config = self.get_account_config(account_id)
        if not account_config:
            return super().audit_links_and_utms(account_id, limit)
        credentials = credentials_from_config(account_config)
        return audit_meta_links_and_utms(credentials, limit)

    def build_provider_payload(self, action: str, account_id: str, object_type: str, payload: dict) -> dict:
        provider_payload = build_meta_ads_payload(action, object_type, payload)
        provider_payload["account_id"] = account_id
        return provider_payload

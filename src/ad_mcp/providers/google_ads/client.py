from __future__ import annotations

from ad_mcp.core.models import ReportRequest, ReportResponse
from ad_mcp.core.models import CapabilityMap
from ad_mcp.providers.base.client import BaseAdsProvider
from ad_mcp.providers.google_ads.account_read import fetch_google_campaign, fetch_google_campaigns
from ad_mcp.providers.google_ads.auth import credentials_from_config
from ad_mcp.providers.google_ads.payloads import build_google_ads_payload
from ad_mcp.providers.google_ads.reporting import fetch_google_report


class GoogleAdsProvider(BaseAdsProvider):
    def __init__(self, config: dict | None = None) -> None:
        super().__init__(
            capabilities=CapabilityMap(
                provider="google_ads",
                read_objects=["account", "campaign", "ad_group", "ad", "keyword", "asset", "extension"],
                write_objects=["campaign", "ad_group", "ad", "keyword", "asset", "audience", "schedule"],
                supported_metrics=[
                    "reach",
                    "impressions",
                    "interactions",
                    "clicks",
                    "spend",
                    "ctr",
                    "cr",
                    "conversions",
                    "quality_score",
                    "expected_ctr",
                    "landing_page_quality",
                    "ad_quality",
                    "impression_share",
                    "lost_impression_share",
                ],
                supported_dimensions=["date", "campaign", "ad_group", "ad", "keyword", "device", "network"],
                supported_campaign_types=["search", "display", "video", "shopping", "pmax", "demand_gen", "app"],
                supported_audience_types=["custom_segment", "remarketing", "customer_list", "similar", "combined"],
                notes=[
                    "Google provider is the primary reference provider in v1.",
                    "Partner integrations are optional modules layered on top of Google Ads.",
                ],
            ),
            source_api="google_ads_api",
            config=config,
        )

    def get_report(self, request: ReportRequest) -> ReportResponse:
        account_config = self.get_account_config(request.account_id)
        if not account_config:
            return super().get_report(request)
        credentials = credentials_from_config(account_config)
        return fetch_google_report(credentials, request, self.capabilities.supported_metrics)

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
        if object_type.strip().lower() != "campaign":
            return super().list_account_objects(account_id, object_type, fields, params, limit)
        if str(account_config.get("google_ads_account_type") or "").strip().lower() == "manager":
            return {
                "provider": "google_ads",
                "account_id": account_id,
                "object_type": "campaign",
                "status": "requires_client_account",
                "message": (
                    "Это управляющий аккаунт Google Ads (MCC), у него нет собственных кампаний. "
                    "Вызовите list_ad_accounts и передайте account_id кабинета с "
                    "google_ads_account_type=customer."
                ),
                "rows": [],
                "source_api": self.source_api,
            }
        credentials = credentials_from_config(account_config)
        return fetch_google_campaigns(credentials, status=(params or {}).get("status"), limit=limit)

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
        if object_type.strip().lower() != "campaign":
            return super().get_account_object(account_id, object_type, object_id, fields)
        credentials = credentials_from_config(account_config)
        return fetch_google_campaign(credentials, object_id)

    def build_provider_payload(self, action: str, account_id: str, object_type: str, payload: dict) -> dict:
        provider_payload = build_google_ads_payload(action, object_type, payload)
        provider_payload["account_id"] = account_id
        return provider_payload

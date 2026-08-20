from __future__ import annotations

import os
import re
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

from ad_mcp.core.config_loader import (
    load_provider_config,
    load_provider_from_connections,
    load_safety_policy,
)
from ad_mcp.core.connection_store import HostedConnectionStore, load_runtime_provider_configs
from ad_mcp.core.meta_skill_presets import (
    build_budget_skill_summary,
    build_clickhouse_contract,
    build_disable_candidates_skill,
    build_report_skill,
    build_scale_candidates_skill,
    build_skill_catalog,
    build_workspace_snapshot,
)
from ad_mcp.core.models import ObjectMutationResponse
from ad_mcp.core.policy import PolicyManager
from ad_mcp.core.preview_manager import PreviewManager
from ad_mcp.providers.google_ads.client import GoogleAdsProvider
from ad_mcp.providers.meta_ads.client import MetaAdsProvider
from ad_mcp.providers.tiktok_ads.client import TikTokAdsProvider
from ad_mcp.providers.yandex_direct.client import YandexDirectProvider
from ad_mcp.reporting.monthly_ads import collect_monthly_ads_report
from ad_mcp.settings import Settings
from ad_mcp.storage.clickhouse import ClickHousePersistence


_ENV_REF_RE = re.compile(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}")
PREVIEW_ONLY_REASON = "Beta MVP работает в preview-only mode. Реальные изменения отключены."
PREVIEW_ONLY_NOTE = "Реальное изменение не выполнено."


class MetaDashboardService:
    def __init__(self, settings: Settings | None = None, *, workspace_id: str | None = None) -> None:
        settings = settings or Settings()
        self._settings = settings
        self._workspace_id = str(workspace_id or "").strip() or None
        safety_policy = load_safety_policy(settings.policy_config_path)
        if settings.preview_only:
            safety_policy.preview_only = True
            safety_policy.execution_mode = "simulated_no_write"
            safety_policy.write_mode = "preview_only"
        self._policy_manager = PolicyManager(safety_policy)
        provider_configs, provider_sources = load_runtime_provider_configs(settings, workspace_id=self._workspace_id)
        self._provider_sources = provider_sources
        provider_config = provider_configs["meta_ads"]
        if not provider_config.get("accounts") and not self._workspace_id:
            provider_config = load_provider_config(settings.project_root / "config/providers", "meta_ads")
            self._provider_sources["meta_ads"] = "provider_example_config"
        self._provider_config = provider_config
        self._provider = MetaAdsProvider(config=provider_config)
        self._preview_manager = PreviewManager()
        self._persistence = ClickHousePersistence(settings)

    def _has_placeholder_credentials(self, account: dict[str, Any]) -> bool:
        markers = ("YOUR_", "<", "EXAMPLE", "CHANGE_ME", "PLACEHOLDER")
        token = str(account.get("access_token", "") or "").strip()
        app_id = str(account.get("app_id", "") or "").strip()
        app_secret = str(account.get("app_secret", "") or "").strip()
        if not token or not app_secret:
            return True
        values = [token, app_secret]
        if app_id:
            values.append(app_id)
        joined = " ".join(values).upper()
        return any(marker in joined for marker in markers)

    def _ensure_account_is_usable(self, account_id: str) -> None:
        account = self._provider.get_account_config(account_id)
        if not account:
            raise ValueError(
                "Аккаунт не найден в конфиге Meta. Проверьте account_id в ads_config.yaml "
                "или config/providers/meta_ads.yaml."
            )
        if self._has_placeholder_credentials(account):
            raise ValueError(
                "Найдены шаблонные креды Meta (placeholder-значения). "
                "Проверьте app_secret и access_token в локальных конфигурациях."
            )

    def _default_account_id(self) -> str:
        accounts = self._provider.config.get("accounts", [])
        if not accounts:
            raise ValueError("No configured Meta Ads accounts found.")
        return str(accounts[0].get("account_id", "")).strip()

    def _resolve_account_id(self, account_id: str | None) -> str:
        return str(account_id or self._default_account_id()).strip()

    def _available_accounts(self) -> list[dict[str, Any]]:
        accounts = self._provider.config.get("accounts", [])
        return [
            {
                "account_id": str(account.get("account_id", "") or ""),
                "name": str(account.get("name", "") or account.get("account_id", "") or "Meta Ads account"),
                "status": str(account.get("status", "") or "configured"),
                "app_id": str(account.get("app_id", "") or ""),
            }
            for account in accounts
        ]

    def _date_window(self, end_date: str | None = None, lookback_days: int = 7) -> tuple[str, str, str]:
        resolved_end = date.fromisoformat(end_date) if end_date else date.today()
        resolved_start = resolved_end - timedelta(days=max(lookback_days - 1, 0))
        start_date = resolved_start.isoformat()
        end_date_iso = resolved_end.isoformat()
        self._policy_manager.validate_report_range(start_date, end_date_iso)
        return start_date, start_date, end_date_iso

    def _count_statuses(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        result: dict[str, int] = {}
        for row in rows:
            status = str(row.get("effective_status") or row.get("status") or "UNKNOWN")
            result[status] = result.get(status, 0) + 1
        return result

    def _friendly_error_message(self, exc: Exception, default_message: str) -> str:
        text = str(exc).strip()
        normalized = text.lower()
        if "2446079" in normalized or "слишком много вызовов" in normalized or "too many calls" in normalized:
            return (
                "Meta временно ограничила частоту API-вызовов по этому кабинету. "
                "Панель покажет частичные данные. Повторите обновление через 1-2 минуты."
            )
        if "timeout" in normalized or "timed out" in normalized:
            return (
                "Источник отвечает слишком долго. Панель покажет частичные данные "
                "и позволит повторить загрузку позже."
            )
        if "invalid parameter" in normalized:
            return default_message
        return text or default_message

    def _safe_call(
        self,
        loader,
        fallback: Any,
        default_message: str,
    ) -> tuple[Any, str | None]:
        try:
            return loader(), None
        except Exception as exc:  # noqa: BLE001
            return deepcopy(fallback), self._friendly_error_message(exc, default_message)

    def _build_dashboard_payload(
        self,
        account_id: str,
        account: dict[str, Any],
        spend: dict[str, Any],
        billing: dict[str, Any],
        campaigns: list[dict[str, Any]],
        adsets: list[dict[str, Any]],
        ads: list[dict[str, Any]],
        issues: dict[str, Any],
        warnings: list[str] | None = None,
    ) -> dict[str, Any]:
        return {
            "provider": "meta_ads",
            "account_id": account_id,
            "account": account,
            "billing": billing,
            "spend": spend,
            "issues": issues,
            "totals": {
                "campaigns": len(campaigns),
                "adsets": len(adsets),
                "ads": len(ads),
            },
            "statuses": {
                "campaigns": self._count_statuses(campaigns),
                "adsets": self._count_statuses(adsets),
                "ads": self._count_statuses(ads),
            },
            "warnings": warnings or [],
        }

    def _build_campaign_structure_rows(
        self,
        campaigns: list[dict[str, Any]],
        adsets: list[dict[str, Any]],
        ads: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        adsets_by_campaign: dict[str, list[dict[str, Any]]] = {}
        ads_by_adset: dict[str, list[dict[str, Any]]] = {}
        for adset in adsets:
            adsets_by_campaign.setdefault(str(adset.get("campaign_id")), []).append(adset)
        for ad in ads:
            ads_by_adset.setdefault(str(ad.get("adset_id")), []).append(ad)

        rows: list[dict[str, Any]] = []
        for campaign in campaigns:
            campaign_adsets = adsets_by_campaign.get(str(campaign.get("id")), [])
            rows.append(
                {
                    "campaign_id": campaign.get("id"),
                    "campaign_name": campaign.get("name"),
                    "campaign_status": campaign.get("effective_status") or campaign.get("status"),
                    "adsets": [
                        {
                            "adset_id": adset.get("id"),
                            "adset_name": adset.get("name"),
                            "adset_status": adset.get("effective_status") or adset.get("status"),
                            "ads": [
                                {
                                    "ad_id": ad.get("id"),
                                    "ad_name": ad.get("name"),
                                    "ad_status": ad.get("effective_status") or ad.get("status"),
                                }
                                for ad in ads_by_adset.get(str(adset.get("id")), [])[:20]
                            ],
                        }
                        for adset in campaign_adsets[:20]
                    ],
                }
            )
        return rows

    def _fetch_workspace_core(
        self,
        account_id: str,
        end_date: str,
    ) -> dict[str, Any]:
        provider = self._provider
        warnings: list[str] = []

        account, warning = self._safe_call(
            lambda: provider.get_account_summary(account_id),
            {"data": {"id": account_id, "name": account_id}},
            "Не удалось получить краткую сводку аккаунта из Meta API.",
        )
        if warning:
            warnings.append(warning)

        spend, warning = self._safe_call(
            lambda: provider.get_spend_overview(account_id, end_date),
            {"periods": []},
            "Не удалось получить spend overview из Meta API.",
        )
        if warning:
            warnings.append(warning)

        billing, warning = self._safe_call(
            lambda: provider.get_billing_summary(account_id),
            {"billing": {}},
            "Не удалось получить billing snapshot из Meta API.",
        )
        if warning:
            warnings.append(warning)

        campaigns_payload, warning = self._safe_call(
            lambda: provider.list_account_objects(account_id, "campaign", limit=200),
            {"rows": []},
            "Не удалось получить список campaigns из Meta API.",
        )
        if warning:
            warnings.append(warning)

        adsets_payload, warning = self._safe_call(
            lambda: provider.list_account_objects(account_id, "adset", limit=500),
            {"rows": []},
            "Не удалось получить список ad sets из Meta API.",
        )
        if warning:
            warnings.append(warning)

        ads_payload, warning = self._safe_call(
            lambda: provider.list_account_objects(account_id, "ad", limit=1000),
            {"rows": []},
            "Не удалось получить список ads из Meta API.",
        )
        if warning:
            warnings.append(warning)

        issues, warning = self._safe_call(
            lambda: provider.get_delivery_issues(account_id, 20),
            {"issues": [], "issue_count": 0},
            "Не удалось получить delivery issues из Meta API.",
        )
        if warning:
            warnings.append(warning)

        return {
            "account": account,
            "spend": spend,
            "billing": billing,
            "campaigns": campaigns_payload.get("rows", []),
            "adsets": adsets_payload.get("rows", []),
            "ads": ads_payload.get("rows", []),
            "issues": issues,
            "warnings": warnings,
        }

    def dashboard(self, account_id: str | None = None, end_date: str | None = None) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        core = self._fetch_workspace_core(resolved_account_id, end_date or date.today().isoformat())
        return self._build_dashboard_payload(
            resolved_account_id,
            core["account"],
            core["spend"],
            core["billing"],
            core["campaigns"],
            core["adsets"],
            core["ads"],
            core["issues"],
            warnings=core["warnings"],
        )

    def campaign_structure(self, account_id: str | None = None) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        core = self._fetch_workspace_core(resolved_account_id, date.today().isoformat())
        return {
            "provider": "meta_ads",
            "account_id": resolved_account_id,
            "rows": self._build_campaign_structure_rows(core["campaigns"][:20], core["adsets"], core["ads"]),
            "warning": core["warnings"][0] if core["warnings"] else None,
        }

    def delivery_issues(self, account_id: str | None = None, limit: int = 20) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        return self._provider.get_delivery_issues(resolved_account_id, limit)

    def connected_assets(self, account_id: str | None = None) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        return self._provider.get_connected_assets(resolved_account_id)

    def top_performers(
        self,
        account_id: str | None = None,
        end_date: str | None = None,
        lookback_days: int = 7,
        entity_level: str = "campaign",
        metric: str = "cost_per_result",
        limit: int = 5,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        start_date, _, end_date_iso = self._date_window(end_date=end_date, lookback_days=lookback_days)
        return self._provider.rank_top_entities(
            resolved_account_id,
            entity_level,
            start_date,
            end_date_iso,
            metric,
            limit,
        )

    def no_result_entities(
        self,
        account_id: str | None = None,
        end_date: str | None = None,
        lookback_days: int = 7,
        entity_level: str = "ad",
        min_spend: float = 20.0,
        limit: int = 10,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        start_date, _, end_date_iso = self._date_window(end_date=end_date, lookback_days=lookback_days)
        ranked = self._provider.rank_top_entities(
            resolved_account_id,
            entity_level,
            start_date,
            end_date_iso,
            "spend",
            300,
        )
        rows = [
            row
            for row in ranked.get("rows", [])
            if float(row.get("spend", 0) or 0) >= min_spend and float(row.get("conversions", 0) or 0) == 0
        ]
        rows.sort(key=lambda row: float(row.get("spend", 0) or 0), reverse=True)
        return {
            "provider": "meta_ads",
            "account_id": resolved_account_id,
            "entity_level": entity_level,
            "rows": rows[:limit],
        }

    def data_contract(self) -> dict[str, Any]:
        return {
            "provider": "meta_ads",
            "clickhouse": build_clickhouse_contract(self._settings),
            "persistence": self._persistence.diagnostics(),
        }

    def skill_catalog(self, account_id: str | None = None, end_date: str | None = None) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        return {
            "provider": "meta_ads",
            "account_id": resolved_account_id,
            "end_date": end_date or date.today().isoformat(),
            "skills": build_skill_catalog(resolved_account_id, end_date),
            "available_accounts": self._available_accounts(),
        }

    def summarize_budget_skill(self, account_id: str | None = None, end_date: str | None = None) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        resolved_end_date = end_date or date.today().isoformat()
        spend = self._provider.get_spend_overview(resolved_account_id, resolved_end_date)
        billing = self._provider.get_billing_summary(resolved_account_id)
        return build_budget_skill_summary(resolved_account_id, resolved_end_date, spend, billing)

    def disable_candidates_skill(
        self,
        account_id: str | None = None,
        end_date: str | None = None,
        lookback_days: int = 7,
        entity_level: str = "ad",
        min_spend: float = 20.0,
        limit: int = 10,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        start_date, _, end_date_iso = self._date_window(end_date=end_date, lookback_days=lookback_days)
        issues = self._provider.get_delivery_issues(resolved_account_id, max(limit * 2, 20))
        no_result = self.no_result_entities(
            account_id=resolved_account_id,
            end_date=end_date_iso,
            lookback_days=lookback_days,
            entity_level=entity_level,
            min_spend=min_spend,
            limit=max(limit * 2, 20),
        )
        return build_disable_candidates_skill(
            resolved_account_id,
            start_date,
            end_date_iso,
            issues,
            no_result,
            min_spend,
            max_items=limit,
        )

    def scale_candidates_skill(
        self,
        account_id: str | None = None,
        end_date: str | None = None,
        lookback_days: int = 7,
        entity_level: str = "campaign",
        max_cost_per_result: float = 20.0,
        min_conversions: float = 1.0,
        limit: int = 10,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        start_date, _, end_date_iso = self._date_window(end_date=end_date, lookback_days=lookback_days)
        performers = self._provider.rank_top_entities(
            resolved_account_id,
            entity_level,
            start_date,
            end_date_iso,
            "cost_per_result",
            max(limit * 3, 20),
        )
        return build_scale_candidates_skill(
            resolved_account_id,
            start_date,
            end_date_iso,
            performers,
            max_cost_per_result=max_cost_per_result,
            min_conversions=min_conversions,
            max_items=limit,
        )

    def collect_report_skill(
        self,
        account_id: str | None = None,
        end_date: str | None = None,
        lookback_days: int = 30,
        entity_level: str = "campaign",
        min_spend: float = 20.0,
        max_cost_per_result: float = 20.0,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        resolved_end_date = end_date or date.today().isoformat()
        budget_summary = self.summarize_budget_skill(resolved_account_id, resolved_end_date)
        disable_candidates = self.disable_candidates_skill(
            account_id=resolved_account_id,
            end_date=resolved_end_date,
            lookback_days=lookback_days,
            entity_level="ad",
            min_spend=min_spend,
            limit=10,
        )
        scale_candidates = self.scale_candidates_skill(
            account_id=resolved_account_id,
            end_date=resolved_end_date,
            lookback_days=lookback_days,
            entity_level=entity_level,
            max_cost_per_result=max_cost_per_result,
            min_conversions=1.0,
            limit=10,
        )
        issues = self._provider.get_delivery_issues(resolved_account_id, 20)
        result = build_report_skill(
            resolved_account_id,
            resolved_end_date,
            budget_summary,
            disable_candidates,
            scale_candidates,
            issues,
        )
        result["monthly_report"] = self.build_monthly_ads_report(
            account_id=resolved_account_id,
            end_date=resolved_end_date,
            lookback_days=lookback_days,
        )
        return result

    def build_monthly_ads_report(
        self,
        account_id: str | None = None,
        end_date: str | None = None,
        lookback_days: int = 30,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        resolved_end_date = end_date or date.today().isoformat()
        start_date, _, end_date_iso = self._date_window(end_date=resolved_end_date, lookback_days=lookback_days)
        account = self._provider.get_account_config(resolved_account_id)
        return collect_monthly_ads_report(
            self._provider,
            provider="meta_ads",
            account_id=resolved_account_id,
            start_date=start_date,
            end_date=end_date_iso,
            timezone_name=str(account.get("timezone") or "UTC"),
            account_name=str(account.get("name") or resolved_account_id),
            currency=str(account.get("currency") or account.get("currency_code") or "USD"),
        )

    def build_monthly_ads_report_for_user(
        self,
        user: Any,
        account_id: str | None = None,
        end_date: str | None = None,
        lookback_days: int = 30,
        provider_name: str | None = None,
    ) -> dict[str, Any]:
        """Build a browser report from the signed-in user's workspace only."""
        store = HostedConnectionStore(
            self._settings.connection_store_file,
            encryption_key=self._settings.credentials_encryption_key,
            allow_legacy_plaintext=self._settings.credentials_allow_legacy_plaintext,
            encryption_required=self._settings.credentials_encryption_required,
        )
        workspace_id = str(getattr(user, "workspace_id", "") or "").strip() or None
        report_provider = str(provider_name or "meta_ads").strip().lower()
        provider_types = {
            "google_ads": GoogleAdsProvider,
            "meta_ads": MetaAdsProvider,
            "tiktok_ads": TikTokAdsProvider,
            "yandex_direct": YandexDirectProvider,
        }
        provider_type = provider_types.get(report_provider)
        if provider_type is None:
            raise ValueError("Для этого типа подключения пока нельзя собрать рекламный отчёт.")
        config = store.provider_config(report_provider, workspace_id=workspace_id)
        provider = provider_type(config=config)
        resolved_account_id = str(account_id or "").strip()
        if not resolved_account_id:
            accounts = config.get("accounts", []) if isinstance(config.get("accounts"), list) else []
            resolved_account_id = str(accounts[0].get("account_id", "") or "").strip() if accounts else ""
        account = provider.get_account_config(resolved_account_id)
        if not account:
            raise ValueError("Рекламный аккаунт не найден в рабочем пространстве пользователя.")
        required_credentials = {
            "meta_ads": ("access_token", "app_secret"),
            "google_ads": ("developer_token", "oauth_client_id", "oauth_client_secret", "refresh_token"),
            "tiktok_ads": ("access_token",),
            "yandex_direct": ("access_token",),
        }.get(report_provider, ())
        if any(not str(account.get(key, "") or "").strip() for key in required_credentials):
            raise ValueError("Для выбранного рекламного кабинета не настроено рабочее подключение.")
        resolved_end_date = end_date or date.today().isoformat()
        start_date, _, end_date_iso = self._date_window(end_date=resolved_end_date, lookback_days=lookback_days)
        return collect_monthly_ads_report(
            provider,
            provider=report_provider,
            account_id=resolved_account_id,
            start_date=start_date,
            end_date=end_date_iso,
            timezone_name=str(account.get("timezone") or account.get("timezone_name") or "UTC"),
            account_name=str(account.get("name") or resolved_account_id),
            currency=str(account.get("currency") or account.get("currency_code") or "USD"),
        )

    def workspace(self, account_id: str | None = None, end_date: str | None = None) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        resolved_end_date = end_date or date.today().isoformat()
        start_date, _, _ = self._date_window(end_date=resolved_end_date, lookback_days=7)
        core = self._fetch_workspace_core(resolved_account_id, resolved_end_date)
        dashboard = self._build_dashboard_payload(
            resolved_account_id,
            core["account"],
            core["spend"],
            core["billing"],
            core["campaigns"],
            core["adsets"],
            core["ads"],
            core["issues"],
            warnings=core["warnings"],
        )
        structure = {
            "provider": "meta_ads",
            "account_id": resolved_account_id,
            "rows": self._build_campaign_structure_rows(core["campaigns"][:20], core["adsets"], core["ads"]),
            "warning": core["warnings"][0] if core["warnings"] else None,
        }
        issues = core["issues"]
        assets, assets_warning = self._safe_call(
            lambda: self._provider.get_connected_assets(resolved_account_id),
            {"pages": [], "instagram_accounts": [], "pixels": [], "custom_conversions": []},
            "Не удалось получить connected assets из Meta API.",
        )
        if assets_warning:
            assets["warning"] = assets_warning
        performers, performers_warning = self._safe_call(
            lambda: self.top_performers(
                account_id=resolved_account_id,
                end_date=resolved_end_date,
                lookback_days=7,
                entity_level="campaign",
                metric="cost_per_result",
                limit=8,
            ),
            {
                "provider": "meta_ads",
                "account_id": resolved_account_id,
                "entity_level": "campaign",
                "metric": "cost_per_result",
                "rows": [],
            },
            "Не удалось получить список top performers из Meta API.",
        )
        if performers_warning:
            performers["warning"] = performers_warning
        no_result, no_result_warning = self._safe_call(
            lambda: self.no_result_entities(
                account_id=resolved_account_id,
                end_date=resolved_end_date,
                lookback_days=7,
                entity_level="ad",
                min_spend=20.0,
                limit=12,
            ),
            {
                "provider": "meta_ads",
                "account_id": resolved_account_id,
                "entity_level": "ad",
                "rows": [],
            },
            "Не удалось получить список сущностей без результата из Meta API.",
        )
        if no_result_warning:
            no_result["warning"] = no_result_warning
        config = self.config_diagnostics()
        persistence = self.persistence_diagnostics()
        auth = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provider": "meta_ads",
            "accounts_checked": 0,
            "auth_ok_count": 0,
            "auth_failed_count": 0,
            "checks": [],
            "warning": "Подробная auth-диагностика загружается отдельно по кнопке.",
        }
        health = {
            "status": "deferred",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "config": {
                "provider_loaded": config.get("provider_loaded"),
                "accounts_total": config.get("runtime", {}).get("accounts_total", 0),
                "env_exists": config.get("env", {}).get("exists"),
                "connections_primary_exists": config.get("connections", {}).get("primary_exists"),
                "env_substitution_ok": config.get("env_substitution", {}).get("all_resolved"),
                "missing_env_vars": config.get("env_substitution", {}).get("missing_vars", []),
                "clickhouse": build_clickhouse_contract(self._settings).get("database", {}),
            },
            "auth": {
                "accounts_checked": 0,
                "auth_ok_count": 0,
                "auth_failed_count": 0,
            },
            "persistence": persistence,
            "warning": "Подробная диагностика загружается отдельно, чтобы не перегружать Meta API на старте.",
        }
        budget_summary = build_budget_skill_summary(resolved_account_id, resolved_end_date, core["spend"], core["billing"])
        disable_candidates = build_disable_candidates_skill(
            resolved_account_id,
            start_date,
            resolved_end_date,
            issues,
            no_result,
            20.0,
            max_items=10,
        )
        scale_candidates = build_scale_candidates_skill(
            resolved_account_id,
            start_date,
            resolved_end_date,
            performers,
            max_cost_per_result=20.0,
            min_conversions=1.0,
            max_items=10,
        )
        report_skill = build_report_skill(
            resolved_account_id,
            resolved_end_date,
            budget_summary,
            disable_candidates,
            scale_candidates,
            issues,
        )
        snapshot = build_workspace_snapshot(
            settings=self._settings,
            account_id=resolved_account_id,
            end_date=resolved_end_date,
            available_accounts=self._available_accounts(),
            dashboard=dashboard,
            structure=structure,
            issues=issues,
            assets=assets,
            performers=performers,
            no_result=no_result,
            config_diagnostics=config,
            auth_diagnostics=auth,
            diagnostics_health=health,
            budget_summary=budget_summary,
            disable_candidates=disable_candidates,
            scale_candidates=scale_candidates,
            report_skill=report_skill,
        )
        snapshot["warnings"] = [
            *core["warnings"],
            *(item for item in (assets_warning, performers_warning, no_result_warning) if item),
        ]
        if self._settings.clickhouse_auto_sync_workspace:
            persistence = self._persistence.sync_workspace(snapshot)
            snapshot["persistence"] = persistence
            snapshot["sections"]["diagnostics"]["persistence"] = persistence
            summary_rows = snapshot.get("summary", {}).get("operator_summary", [])
            if summary_rows:
                summary_rows[-1]["value"] = f"Статус синка: {persistence.get('status', 'unknown')}"
        return snapshot

    def _build_preview_response(self, action: str, account_id: str, object_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._policy_manager.ensure_simulated_no_write()
        self._policy_manager.validate_mutation_payload(payload)
        preview = self._provider.preview_mutation(action, account_id, object_type, payload)
        self._preview_manager.create(preview)
        response = ObjectMutationResponse(
            status="preview",
            provider="meta_ads",
            account_id=account_id,
            object_type=object_type,
            action=action,  # type: ignore[arg-type]
            preview_token=preview.token,
            diff=preview.diff,
            risk_flags=preview.risk_flags,
            provider_payload=preview.provider_payload,
        ).model_dump()
        response.update(
            {
                "mode": "preview_only",
                "will_apply": False,
                "reason": PREVIEW_ONLY_REASON,
                "note": PREVIEW_ONLY_NOTE,
            }
        )
        response["persistence"] = self._persistence.log_preview_action(response)
        return response

    def preview_clone_campaign(
        self,
        source_campaign_id: str,
        new_name: str | None = None,
        daily_budget: float | None = None,
        lifetime_budget: float | None = None,
        status: str = "PAUSED",
        account_id: str | None = None,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        payload = {
            "name": new_name,
            "status": status,
            "daily_budget": daily_budget,
            "lifetime_budget": lifetime_budget,
            "source_campaign_id": source_campaign_id,
            "clone_options": {"include_adsets": True, "include_ads": True},
        }
        return self._build_preview_response("create", resolved_account_id, "campaign", payload)

    def preview_update_campaign_budget(
        self,
        campaign_id: str,
        daily_budget: float | None = None,
        lifetime_budget: float | None = None,
        spend_cap: float | None = None,
        budget_delta_percent: float | None = None,
        account_id: str | None = None,
    ) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        payload = {
            "id": campaign_id,
            "daily_budget": daily_budget,
            "lifetime_budget": lifetime_budget,
            "spend_cap": spend_cap,
            "budget_delta_percent": budget_delta_percent,
        }
        return self._build_preview_response("update", resolved_account_id, "campaign", payload)

    def preview_pause_ads(self, ids: list[str], account_id: str | None = None) -> dict[str, Any]:
        resolved_account_id = self._resolve_account_id(account_id)
        self._ensure_account_is_usable(resolved_account_id)
        payload = {
            "ids": ids,
            "status": "PAUSED",
            "bulk_count": len(ids),
            "extra_fields": {"operation": "bulk_pause"},
        }
        return self._build_preview_response("update", resolved_account_id, "ad", payload)

    def _mask_secret(self, value: Any, head: int = 6, tail: int = 4) -> str:
        text = str(value or "")
        if not text:
            return "(пусто)"
        if len(text) <= head + tail:
            return "*" * len(text)
        return f"{text[:head]}...{text[-tail:]}"

    def _read_yaml_without_expansion(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            with path.open("r", encoding="utf-8") as handle:
                return yaml.safe_load(handle) or {}
        except Exception:
            return {}

    def _connections_paths(self) -> tuple[Path, Path]:
        primary = self._settings.connections_config_path
        example = primary.with_name(f"{primary.stem}.example{primary.suffix}")
        return primary, example

    def _load_runtime_meta_config(self) -> dict[str, Any]:
        provider_configs, provider_sources = load_runtime_provider_configs(self._settings, workspace_id=self._workspace_id)
        self._provider_sources = provider_sources
        provider_config = provider_configs["meta_ads"]
        if provider_config.get("accounts") or self._workspace_id:
            return provider_config
        self._provider_sources["meta_ads"] = "provider_example_config"
        return load_provider_config(self._settings.project_root / "config/providers", "meta_ads")

    def _load_raw_meta_config(self) -> tuple[dict[str, Any], str, Path]:
        connections_primary, connections_example = self._connections_paths()
        source_kind = "connections_primary"
        source_path = connections_primary

        raw_connections = self._read_yaml_without_expansion(connections_primary)
        if not raw_connections:
            raw_connections = self._read_yaml_without_expansion(connections_example)
            source_kind = "connections_example"
            source_path = connections_example

        provider = (raw_connections.get("providers") or {}).get("meta_ads") or {}
        if provider.get("accounts"):
            return provider, source_kind, source_path

        provider_primary = self._settings.project_root / "config/providers/meta_ads.yaml"
        provider_example = self._settings.project_root / "config/providers/meta_ads.example.yaml"
        raw_provider = self._read_yaml_without_expansion(provider_primary)
        source_kind = "provider_primary"
        source_path = provider_primary

        if not raw_provider:
            raw_provider = self._read_yaml_without_expansion(provider_example)
            source_kind = "provider_example"
            source_path = provider_example

        return raw_provider, source_kind, source_path

    def _env_reference_status(self, raw_value: Any) -> dict[str, Any]:
        if not isinstance(raw_value, str):
            return {"has_env_ref": False, "resolved": True, "vars": []}

        refs = [match.group(1) for match in _ENV_REF_RE.finditer(raw_value)]
        if not refs:
            return {"has_env_ref": False, "resolved": True, "vars": []}

        missing = [item for item in refs if os.getenv(item) in (None, "")]
        return {
            "has_env_ref": True,
            "resolved": not missing,
            "vars": refs,
            "missing_vars": missing,
        }

    def config_diagnostics(self) -> dict[str, Any]:
        env_path = self._settings.project_root / ".env"
        connections_primary, connections_example = self._connections_paths()

        runtime_provider = self._load_runtime_meta_config()
        raw_provider, raw_source_kind, raw_source_path = self._load_raw_meta_config()
        runtime_accounts = runtime_provider.get("accounts") or []
        raw_accounts = raw_provider.get("accounts") or []

        accounts: list[dict[str, Any]] = []
        for index, runtime_account in enumerate(runtime_accounts):
            raw_account = raw_accounts[index] if index < len(raw_accounts) else {}
            access_token = str(runtime_account.get("access_token", "") or "")
            app_secret = str(runtime_account.get("app_secret", "") or "")
            account_id = str(runtime_account.get("account_id", "") or "")
            access_ref = self._env_reference_status(raw_account.get("access_token"))
            secret_ref = self._env_reference_status(raw_account.get("app_secret"))

            accounts.append(
                {
                    "name": runtime_account.get("name") or f"Account #{index + 1}",
                    "account_id": account_id,
                    "status": runtime_account.get("status") or "unknown",
                    "app_id": str(runtime_account.get("app_id", "") or ""),
                    "api_version": str(runtime_account.get("api_version", "") or ""),
                    "access_token": {
                        "present": bool(access_token),
                        "masked": self._mask_secret(access_token),
                        "looks_placeholder": self._has_placeholder_credentials({"access_token": access_token, "app_secret": "x"}),
                        "env_ref": access_ref,
                    },
                    "app_secret": {
                        "present": bool(app_secret),
                        "masked": self._mask_secret(app_secret),
                        "looks_placeholder": self._has_placeholder_credentials({"access_token": "x", "app_secret": app_secret}),
                        "env_ref": secret_ref,
                    },
                }
            )

        runtime_account_ids = [str(item.get("account_id", "") or "") for item in runtime_accounts]
        unresolved_env_vars = sorted(
            {
                missing_var
                for account in accounts
                for secret_key in ("access_token", "app_secret")
                for missing_var in account[secret_key]["env_ref"].get("missing_vars", [])
            }
        )

        provider_loaded = bool(runtime_accounts)
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provider": "meta_ads",
            "provider_loaded": provider_loaded,
            "project_root": str(self._settings.project_root),
            "env": {
                "path": str(env_path),
                "exists": env_path.exists(),
                "loaded_hint": env_path.exists(),
            },
            "connections": {
                "primary_path": str(connections_primary),
                "primary_exists": connections_primary.exists(),
                "example_path": str(connections_example),
                "example_exists": connections_example.exists(),
                "runtime_source": self._provider_sources.get("meta_ads", "unknown"),
                "connection_store_path": str(self._settings.connection_store_file),
                "connection_store_exists": self._settings.connection_store_file.exists(),
                "fallback_to_local": self._settings.connections_fallback_to_local,
                "raw_source_kind": raw_source_kind,
                "raw_source_path": str(raw_source_path),
            },
            "runtime": {
                "accounts_total": len(runtime_accounts),
                "runtime_account_ids": runtime_account_ids,
                "accounts": accounts,
            },
            "env_substitution": {
                "all_resolved": not unresolved_env_vars,
                "missing_vars": unresolved_env_vars,
            },
        }

    def auth_diagnostics(self) -> dict[str, Any]:
        runtime_provider = self._load_runtime_meta_config()
        self._provider_config = runtime_provider
        self._provider = MetaAdsProvider(config=runtime_provider)

        accounts = runtime_provider.get("accounts") or []
        checks: list[dict[str, Any]] = []

        for account in accounts:
            account_id = str(account.get("account_id", "") or "")
            name = str(account.get("name", "") or account_id or "Unknown account")
            token = str(account.get("access_token", "") or "")
            secret = str(account.get("app_secret", "") or "")

            check: dict[str, Any] = {
                "name": name,
                "account_id": account_id,
                "access_token_masked": self._mask_secret(token),
                "app_secret_masked": self._mask_secret(secret),
                "token_present": bool(token),
                "app_secret_present": bool(secret),
                "app_id": str(account.get("app_id", "") or ""),
                "auth_ok": False,
                "error": None,
                "account_name_from_meta": None,
                "meta_account_status": None,
            }

            if not token or not secret:
                check["error"] = "Пустой access_token или app_secret в runtime-конфиге"
                checks.append(check)
                continue

            if self._has_placeholder_credentials(account):
                check["error"] = "Обнаружены placeholder-значения в credentials"
                checks.append(check)
                continue

            try:
                summary = self._provider.get_account_summary(account_id, fields=["id", "name", "account_status", "currency"])
                meta = summary.get("data") if isinstance(summary, dict) else {}
                check["auth_ok"] = True
                check["account_name_from_meta"] = meta.get("name") if isinstance(meta, dict) else None
                check["meta_account_status"] = meta.get("account_status") if isinstance(meta, dict) else None
            except Exception as exc:  # noqa: BLE001
                check["error"] = str(exc)

            checks.append(check)

        ok_count = sum(1 for item in checks if item.get("auth_ok"))
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provider": "meta_ads",
            "accounts_checked": len(checks),
            "auth_ok_count": ok_count,
            "auth_failed_count": len(checks) - ok_count,
            "checks": checks,
        }

    def persistence_diagnostics(self) -> dict[str, Any]:
        diagnostics = self._persistence.diagnostics()
        diagnostics["timestamp"] = datetime.now(timezone.utc).isoformat()
        diagnostics["provider"] = "meta_ads"
        return diagnostics

    def diagnostics_health(self) -> dict[str, Any]:
        config = self.config_diagnostics()
        auth = self.auth_diagnostics()
        persistence = self.persistence_diagnostics()
        persistence_failed = (
            persistence.get("enabled")
            and persistence.get("configured")
            and not persistence.get("reachable")
        )
        status = (
            "ok"
            if auth.get("auth_failed_count", 0) == 0 and config.get("provider_loaded") and not persistence_failed
            else "degraded"
        )
        return {
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "config": {
                "provider_loaded": config.get("provider_loaded"),
                "accounts_total": config.get("runtime", {}).get("accounts_total", 0),
                "env_exists": config.get("env", {}).get("exists"),
                "connections_primary_exists": config.get("connections", {}).get("primary_exists"),
                "env_substitution_ok": config.get("env_substitution", {}).get("all_resolved"),
                "missing_env_vars": config.get("env_substitution", {}).get("missing_vars", []),
                "clickhouse": build_clickhouse_contract(self._settings).get("database", {}),
            },
            "auth": {
                "accounts_checked": auth.get("accounts_checked", 0),
                "auth_ok_count": auth.get("auth_ok_count", 0),
                "auth_failed_count": auth.get("auth_failed_count", 0),
            },
            "persistence": persistence,
        }

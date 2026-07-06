from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from ad_mcp.core.connection_store import HostedConnectionStore, safe_account_summary
from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.settings import Settings


SEARCH_CONSOLE_PROVIDER = "google_search_console"
ALL_PROPERTIES = "__all"


class SearchConsoleReportService:
    def __init__(self, settings: Settings | None = None, http_client: httpx.Client | None = None) -> None:
        self._settings = settings or Settings()
        self._store = HostedConnectionStore(self._settings.connection_store_file)
        self._http_client = http_client

    def report(self, user: Any | None = None, *, site_url: str = "", days: int = 28) -> dict[str, Any]:
        workspace_id = self._workspace_id(user)
        config = self._store.provider_config(SEARCH_CONSOLE_PROVIDER, workspace_id=workspace_id)
        accounts = [account for account in config.get("accounts", []) if isinstance(account, dict)]
        safe_properties = [safe_account_summary(account) for account in accounts]
        if not accounts:
            return {
                "status": "not_connected",
                "provider": SEARCH_CONSOLE_PROVIDER,
                "properties": [],
                "message": "Подключите Google Search Console, чтобы видеть SEO-отчеты по запросам, страницам и sitemap.",
            }
        selected_accounts, selected_property = self._select_properties(accounts, site_url)
        if not selected_accounts:
            return {
                "status": "property_not_found",
                "provider": SEARCH_CONSOLE_PROVIDER,
                "properties": safe_properties,
                "message": "Выбранная property не найдена в подключении Search Console.",
            }
        end_date = date.today() - timedelta(days=3)
        clean_days = max(7, min(int(days or 28), 90))
        start_date = end_date - timedelta(days=clean_days - 1)
        previous_end = start_date - timedelta(days=1)
        previous_start = previous_end - timedelta(days=clean_days - 1)
        try:
            property_summaries = self._property_summaries(accounts, start_date, end_date)
            summary = self._query_many(selected_accounts, start_date, end_date, [], 1)
            previous_summary = self._query_many(selected_accounts, previous_start, previous_end, [], 1)
            top_queries = self._query_many(selected_accounts, start_date, end_date, ["query"], 25)
            top_pages = self._query_many(selected_accounts, start_date, end_date, ["page"], 25)
            trend = self._query_many(selected_accounts, start_date, end_date, ["date"], clean_days)
            sitemaps = self._sitemaps_many(selected_accounts)
        except (httpx.HTTPError, ValueError) as exc:
            return {
                "status": "api_error",
                "provider": SEARCH_CONSOLE_PROVIDER,
                "properties": safe_properties,
                "selected_property": selected_property,
                "message": redact_secret_text(str(exc))[:360],
            }
        total = self._totals(summary)
        previous_total = self._totals(previous_summary)
        return {
            "status": "ok",
            "provider": SEARCH_CONSOLE_PROVIDER,
            "date_range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "days": clean_days},
            "previous_date_range": {
                "start_date": previous_start.isoformat(),
                "end_date": previous_end.isoformat(),
                "days": clean_days,
            },
            "properties": safe_properties,
            "property_summaries": property_summaries,
            "selected_property": selected_property,
            "metrics": total,
            "previous_metrics": previous_total,
            "deltas": self._metric_deltas(total, previous_total),
            "top_queries": self._rows(top_queries, "query")[:15],
            "top_pages": self._rows(top_pages, "page")[:15],
            "trend": self._rows(trend, "date"),
            "opportunities": self._opportunities(top_queries),
            "insights": self._insights(total, previous_total, top_queries, top_pages),
            "sitemaps": sitemaps,
        }

    def _workspace_id(self, user: Any | None = None) -> str | None:
        value = getattr(user, "workspace_id", None)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def _select_properties(self, accounts: list[dict[str, Any]], site_url: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        requested = site_url.strip()
        if requested and requested != ALL_PROPERTIES:
            for account in accounts:
                if str(account.get("site_url") or account.get("account_id") or "").strip() == requested:
                    return [account], safe_account_summary(account)
            return [], {}
        selected = {
            "name": "Все ресурсы Search Console",
            "account_id": ALL_PROPERTIES,
            "site_url": ALL_PROPERTIES,
            "property_type": "aggregate",
            "status": "connected",
        }
        return accounts, selected

    def _client(self) -> tuple[httpx.Client, bool]:
        if self._http_client is not None:
            return self._http_client, False
        return httpx.Client(timeout=20.0), True

    def _access_token(self, account: dict[str, Any]) -> str:
        refresh_token = str(account.get("refresh_token") or "").strip()
        client_id = str(account.get("oauth_client_id") or "").strip()
        client_secret = str(account.get("oauth_client_secret") or "").strip()
        if refresh_token and client_id and client_secret:
            client, close_client = self._client()
            try:
                response = client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token",
                    },
                )
                response.raise_for_status()
                payload = response.json()
            finally:
                if close_client:
                    client.close()
            token = str(payload.get("access_token") or "").strip() if isinstance(payload, dict) else ""
            if token:
                return token
        token = str(account.get("access_token") or "").strip()
        if token:
            return token
        raise ValueError("Search Console access token is missing. Reconnect Google Search Console.")

    def _account_site_url(self, account: dict[str, Any]) -> str:
        site_url = str(account.get("site_url") or account.get("account_id") or "").strip()
        if not site_url:
            raise ValueError("Search Console property URL is missing. Reconnect Google Search Console.")
        return site_url

    def _property_summaries(self, accounts: list[dict[str, Any]], start_date: date, end_date: date) -> list[dict[str, Any]]:
        summaries: list[dict[str, Any]] = []
        for account in accounts:
            safe = safe_account_summary(account)
            try:
                payload = self._query(self._access_token(account), self._account_site_url(account), start_date, end_date, [], 1)
                summaries.append(safe | {"metrics": self._totals(payload), "status": "ok"})
            except (httpx.HTTPError, ValueError) as exc:
                summaries.append(safe | {"status": "api_error", "message": redact_secret_text(str(exc))[:240]})
        return summaries

    def _query_many(
        self,
        accounts: list[dict[str, Any]],
        start_date: date,
        end_date: date,
        dimensions: list[str],
        row_limit: int,
    ) -> dict[str, Any]:
        payloads: list[dict[str, Any]] = []
        errors: list[Exception] = []
        for account in accounts:
            try:
                payloads.append(
                    self._query(
                        self._access_token(account),
                        self._account_site_url(account),
                        start_date,
                        end_date,
                        dimensions,
                        row_limit,
                    )
                )
            except (httpx.HTTPError, ValueError) as exc:
                errors.append(exc)
        if not payloads:
            message = str(errors[0]) if errors else "Search Console returned no data."
            raise ValueError(message)
        if not dimensions:
            rows = [{"clicks": 0.0, "impressions": 0.0, "ctr": 0.0, "position": 0.0}]
            for payload in payloads:
                total = self._totals(payload)
                rows[0]["clicks"] += float(total["clicks"])
                rows[0]["impressions"] += float(total["impressions"])
                rows[0]["position"] += float(total["position"]) * float(total["impressions"])
            impressions = rows[0]["impressions"]
            rows[0]["ctr"] = rows[0]["clicks"] / impressions if impressions else 0.0
            rows[0]["position"] = rows[0]["position"] / impressions if impressions else 0.0
            return {"rows": rows}
        grouped: dict[str, dict[str, Any]] = {}
        for payload in payloads:
            for row in payload.get("rows", []) if isinstance(payload.get("rows"), list) else []:
                if not isinstance(row, dict):
                    continue
                keys = row.get("keys") if isinstance(row.get("keys"), list) else []
                key = str(keys[0] if keys else "")
                item = grouped.setdefault(key, {"keys": [key], "clicks": 0.0, "impressions": 0.0, "position_weighted": 0.0})
                clicks = float(row.get("clicks") or 0)
                impressions = float(row.get("impressions") or 0)
                item["clicks"] += clicks
                item["impressions"] += impressions
                item["position_weighted"] += float(row.get("position") or 0) * impressions
        rows = []
        for item in grouped.values():
            impressions = float(item["impressions"] or 0)
            clicks = float(item["clicks"] or 0)
            rows.append(
                {
                    "keys": item["keys"],
                    "clicks": clicks,
                    "impressions": impressions,
                    "ctr": clicks / impressions if impressions else 0.0,
                    "position": float(item["position_weighted"] or 0) / impressions if impressions else 0.0,
                }
            )
        rows.sort(key=lambda row: (float(row.get("clicks") or 0), float(row.get("impressions") or 0)), reverse=True)
        return {"rows": rows[:row_limit]}

    def _query(
        self,
        access_token: str,
        site_url: str,
        start_date: date,
        end_date: date,
        dimensions: list[str],
        row_limit: int,
    ) -> dict[str, Any]:
        encoded_site = quote(site_url, safe="")
        client, close_client = self._client()
        try:
            response = client.post(
                f"https://www.googleapis.com/webmasters/v3/sites/{encoded_site}/searchAnalytics/query",
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "startDate": start_date.isoformat(),
                    "endDate": end_date.isoformat(),
                    "dimensions": dimensions,
                    "rowLimit": row_limit,
                    "type": "web",
                    "dataState": "final",
                },
            )
            response.raise_for_status()
            payload = response.json()
        finally:
            if close_client:
                client.close()
        if not isinstance(payload, dict):
            raise ValueError("Search Console returned a non-object payload.")
        return payload

    def _sitemaps_many(self, accounts: list[dict[str, Any]]) -> dict[str, Any]:
        result = {"count": 0, "items": [], "errors": 0, "warnings": 0}
        items: list[dict[str, Any]] = []
        for account in accounts:
            try:
                payload = self._sitemaps(self._access_token(account), self._account_site_url(account))
            except (httpx.HTTPError, ValueError):
                continue
            result["count"] = int(result["count"]) + int(payload.get("count") or 0)
            for item in payload.get("items", []):
                if isinstance(item, dict):
                    item = dict(item)
                    item["site_url"] = account.get("site_url")
                    items.append(item)
                    result["errors"] = int(result["errors"]) + int(item.get("errors") or 0)
                    result["warnings"] = int(result["warnings"]) + int(item.get("warnings") or 0)
        result["items"] = items[:20]
        return result

    def _sitemaps(self, access_token: str, site_url: str) -> dict[str, Any]:
        encoded_site = quote(site_url, safe="")
        client, close_client = self._client()
        try:
            response = client.get(
                f"https://www.googleapis.com/webmasters/v3/sites/{encoded_site}/sitemaps",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            payload = response.json()
        finally:
            if close_client:
                client.close()
        items = payload.get("sitemap", []) if isinstance(payload, dict) else []
        sitemaps = []
        for item in (items[:10] if isinstance(items, list) else []):
            if not isinstance(item, dict):
                continue
            sitemaps.append(
                {
                    "path": item.get("path"),
                    "last_submitted": item.get("lastSubmitted"),
                    "last_downloaded": item.get("lastDownloaded"),
                    "is_pending": item.get("isPending"),
                    "is_sitemaps_index": item.get("isSitemapsIndex"),
                    "warnings": item.get("warnings"),
                    "errors": item.get("errors"),
                }
            )
        return {"count": len(items) if isinstance(items, list) else 0, "items": sitemaps}

    def _totals(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = payload.get("rows", []) if isinstance(payload.get("rows"), list) else []
        row = rows[0] if rows and isinstance(rows[0], dict) else {}
        return {
            "clicks": round(float(row.get("clicks") or 0), 2),
            "impressions": round(float(row.get("impressions") or 0), 2),
            "ctr": round(float(row.get("ctr") or 0), 4),
            "position": round(float(row.get("position") or 0), 2),
        }

    def _rows(self, payload: dict[str, Any], key_name: str) -> list[dict[str, Any]]:
        rows = payload.get("rows", []) if isinstance(payload.get("rows"), list) else []
        normalized: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            keys = row.get("keys") if isinstance(row.get("keys"), list) else []
            normalized.append(
                {
                    key_name: str(keys[0] if keys else ""),
                    "clicks": round(float(row.get("clicks") or 0), 2),
                    "impressions": round(float(row.get("impressions") or 0), 2),
                    "ctr": round(float(row.get("ctr") or 0), 4),
                    "position": round(float(row.get("position") or 0), 2),
                }
            )
        return normalized

    def _opportunities(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        rows = self._rows(payload, "query")
        candidates = [
            row
            for row in rows
            if float(row.get("impressions") or 0) >= 10 and 4 <= float(row.get("position") or 0) <= 20
        ]
        return sorted(candidates, key=lambda row: float(row.get("impressions") or 0), reverse=True)[:5]

    def _metric_deltas(self, current: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
        return {
            "clicks": self._delta(float(current.get("clicks") or 0), float(previous.get("clicks") or 0)),
            "impressions": self._delta(float(current.get("impressions") or 0), float(previous.get("impressions") or 0)),
            "ctr": self._delta(float(current.get("ctr") or 0), float(previous.get("ctr") or 0)),
            "position": self._delta(float(current.get("position") or 0), float(previous.get("position") or 0), lower_is_better=True),
        }

    def _delta(self, current: float, previous: float, *, lower_is_better: bool = False) -> dict[str, Any]:
        absolute = current - previous
        percent = (absolute / previous) if previous else None
        improved = absolute < 0 if lower_is_better else absolute > 0
        return {
            "absolute": round(absolute, 4),
            "percent": round(percent, 4) if percent is not None else None,
            "direction": "up" if absolute > 0 else "down" if absolute < 0 else "flat",
            "improved": improved if absolute else None,
        }

    def _insights(
        self,
        current: dict[str, Any],
        previous: dict[str, Any],
        query_payload: dict[str, Any],
        page_payload: dict[str, Any],
    ) -> list[dict[str, str]]:
        insights: list[dict[str, str]] = []
        deltas = self._metric_deltas(current, previous)
        if deltas["clicks"]["percent"] is not None:
            percent = float(deltas["clicks"]["percent"] or 0)
            insights.append(
                {
                    "tone": "positive" if percent >= 0 else "warning",
                    "title": "Динамика кликов",
                    "text": f"Клики {'выросли' if percent >= 0 else 'снизились'} на {abs(percent) * 100:.1f}% к предыдущему периоду.",
                }
            )
        opportunities = self._opportunities(query_payload)
        if opportunities:
            top = opportunities[0]
            insights.append(
                {
                    "tone": "action",
                    "title": "Ближайшая точка роста",
                    "text": f"Запрос «{top.get('query')}» имеет {int(float(top.get('impressions') or 0))} показов и среднюю позицию {top.get('position')}. Его стоит усилить на странице и в сниппете.",
                }
            )
        low_ctr_pages = [
            row
            for row in self._rows(page_payload, "page")
            if float(row.get("impressions") or 0) >= 50 and float(row.get("ctr") or 0) < 0.02
        ]
        if low_ctr_pages:
            insights.append(
                {
                    "tone": "warning",
                    "title": "Низкий CTR страницы",
                    "text": f"Страница {low_ctr_pages[0].get('page')} получает показы, но CTR ниже 2%. Проверьте title, description и соответствие интенту.",
                }
            )
        return insights[:4]

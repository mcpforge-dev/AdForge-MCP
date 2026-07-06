from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from ad_mcp.core.connection_store import HostedConnectionStore, safe_account_summary
from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.settings import Settings


SEARCH_CONSOLE_PROVIDER = "google_search_console"


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
        selected = self._select_property(accounts, site_url)
        if selected is None:
            return {
                "status": "property_not_found",
                "provider": SEARCH_CONSOLE_PROVIDER,
                "properties": safe_properties,
                "message": "Выбранная property не найдена в подключении Search Console.",
            }
        end_date = date.today() - timedelta(days=3)
        clean_days = max(7, min(int(days or 28), 90))
        start_date = end_date - timedelta(days=clean_days - 1)
        try:
            access_token = self._access_token(selected)
            summary = self._query(access_token, selected["site_url"], start_date, end_date, [], 1)
            top_queries = self._query(access_token, selected["site_url"], start_date, end_date, ["query"], 10)
            top_pages = self._query(access_token, selected["site_url"], start_date, end_date, ["page"], 10)
            trend = self._query(access_token, selected["site_url"], start_date, end_date, ["date"], clean_days)
            sitemaps = self._sitemaps(access_token, selected["site_url"])
        except (httpx.HTTPError, ValueError) as exc:
            return {
                "status": "api_error",
                "provider": SEARCH_CONSOLE_PROVIDER,
                "properties": safe_properties,
                "selected_property": safe_account_summary(selected),
                "message": redact_secret_text(str(exc))[:360],
            }
        total = self._totals(summary)
        return {
            "status": "ok",
            "provider": SEARCH_CONSOLE_PROVIDER,
            "date_range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "days": clean_days},
            "properties": safe_properties,
            "selected_property": safe_account_summary(selected),
            "metrics": total,
            "top_queries": self._rows(top_queries, "query"),
            "top_pages": self._rows(top_pages, "page"),
            "trend": self._rows(trend, "date"),
            "opportunities": self._opportunities(top_queries),
            "sitemaps": sitemaps,
        }

    def _workspace_id(self, user: Any | None = None) -> str | None:
        value = getattr(user, "workspace_id", None)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def _select_property(self, accounts: list[dict[str, Any]], site_url: str) -> dict[str, Any] | None:
        requested = site_url.strip()
        if requested:
            for account in accounts:
                if str(account.get("site_url") or account.get("account_id") or "").strip() == requested:
                    return account
            return None
        return accounts[0]

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

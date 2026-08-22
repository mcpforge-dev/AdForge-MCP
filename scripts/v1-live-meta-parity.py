from __future__ import annotations

import json
import hashlib
from pathlib import Path

from ad_mcp.core.connection_store import HostedConnectionStore, _workspace_roots
from ad_mcp.core.models import DateRange, ReportRequest
from ad_mcp.providers.meta_ads.client import MetaAdsProvider


TARGET_ACCOUNT = "act_1423247033195473"
TARGET_PAGE = "110901223663187"
START = "2026-08-15"
END = "2026-08-21"

store = HostedConnectionStore(Path("/var/lib/adforge-mcp/connections.json"))
config = {}
for workspace_id, _root in _workspace_roots(store.read()):
    candidate = store.provider_config("meta_ads", workspace_id=workspace_id)
    accounts = candidate.get("accounts") if isinstance(candidate, dict) else []
    for item in accounts if isinstance(accounts, list) else []:
        if isinstance(item, dict) and str(item.get("account_id")) == TARGET_ACCOUNT:
            config = dict(item)
            config.update({key: value for key, value in candidate.items() if key != "accounts"})
            break
    if config:
        break
if not config:
    raise RuntimeError("target Meta account not found")

provider = MetaAdsProvider({"accounts": [config]})
campaigns = provider.list_account_objects(
    TARGET_ACCOUNT,
    "campaign",
    fields=["id", "name", "status", "effective_status", "objective", "daily_budget", "lifetime_budget"],
    limit=500,
)
report = provider.get_report(
    ReportRequest(
        provider="meta_ads",
        account_id=TARGET_ACCOUNT,
        entity_level="account",
        date_range=DateRange(start_date=START, end_date=END),
        fields=["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "conversions"],
    )
)
businesses = provider.list_meta_businesses(TARGET_ACCOUNT, limit=100)
pages = provider.list_meta_pages(TARGET_ACCOUNT, limit=100)
instagram = provider.get_page_instagram_account(TARGET_ACCOUNT, TARGET_PAGE)
try:
    posts = provider.list_page_posts(TARGET_ACCOUNT, TARGET_PAGE, limit=5)
    posts_status = "ok"
except Exception as exc:
    posts = {}
    posts_status = type(exc).__name__
totals = {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0}
for row in report.rows:
    totals["spend"] += float(row.get("spend") or 0)
    totals["impressions"] += int(row.get("impressions") or 0)
    totals["clicks"] += int(row.get("clicks") or 0)
    totals["conversions"] += float(row.get("conversions") or 0)
print(json.dumps({
    "campaign_count": len(campaigns.get("rows", [])),
    "campaign_id_hash": hashlib.sha256(json.dumps(sorted(
        str(row.get("id") or row.get("campaign_id"))
        for row in campaigns.get("rows", [])
        if isinstance(row, dict) and (row.get("id") is not None or row.get("campaign_id") is not None)
    ), separators=(",", ":")).encode()).hexdigest(),
    "report_rows": len(report.rows),
    "totals": totals,
    "business_count": len(businesses.get("businesses", [])),
    "page_count": len(pages.get("pages", [])),
    "instagram_linked": bool(instagram.get("instagram_account")),
    "page_posts": posts_status,
    "action_metric_types": config.get("action_metrics") if isinstance(config.get("action_metrics"), list) else [],
}))

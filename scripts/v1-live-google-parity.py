from __future__ import annotations

import json
import hashlib
from pathlib import Path

from ad_mcp.core.connection_store import HostedConnectionStore, _workspace_roots
from ad_mcp.core.models import DateRange, ReportRequest
from ad_mcp.providers.google_ads.account_read import fetch_google_campaigns
from ad_mcp.providers.google_ads.auth import credentials_from_config
from ad_mcp.providers.google_ads.reporting import fetch_google_report


TARGET_ACCOUNT = "1192358582"
START = "2026-08-15"
END = "2026-08-21"

store = HostedConnectionStore(Path("/var/lib/adforge-mcp/connections.json"))
config = {}
for workspace_id, _root in _workspace_roots(store.read()):
    candidate = store.provider_config("google_ads", workspace_id=workspace_id)
    accounts = candidate.get("accounts") if isinstance(candidate, dict) else []
    if any(str(item.get("account_id")) == TARGET_ACCOUNT for item in accounts if isinstance(item, dict)):
        config = next(item for item in accounts if isinstance(item, dict) and str(item.get("account_id")) == TARGET_ACCOUNT)
        config.update({key: value for key, value in candidate.items() if key != "accounts"})
        break
if not config:
    raise RuntimeError("target Google account not found")
credentials = credentials_from_config(config)
campaigns = fetch_google_campaigns(credentials, limit=500)
report = fetch_google_report(
    credentials,
    ReportRequest(
        provider="google_ads",
        account_id=credentials.customer_id,
        entity_level="account",
        date_range=DateRange(start_date=START, end_date=END),
        fields=["impressions", "clicks", "spend", "conversions"],
    ),
    ["impressions", "clicks", "spend", "conversions"],
)
totals = {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0}
for row in report.rows:
    totals["spend"] += float(row.get("spend") or 0)
    totals["impressions"] += int(row.get("impressions") or 0)
    totals["clicks"] += int(row.get("clicks") or 0)
    totals["conversions"] += float(row.get("conversions") or 0)
campaign_ids = sorted(
    str(row.get("id") or row.get("campaign_id"))
    for row in campaigns["rows"]
    if isinstance(row, dict) and (row.get("id") is not None or row.get("campaign_id") is not None)
)
print(json.dumps({
    "campaign_count": len(campaigns["rows"]),
    "campaign_key_set": sorted({key for row in campaigns["rows"] if isinstance(row, dict) for key in row}),
    "campaign_id_hash": hashlib.sha256(json.dumps(campaign_ids, separators=(",", ":")).encode()).hexdigest(),
    "report_rows": len(report.rows),
    "totals": totals,
}))

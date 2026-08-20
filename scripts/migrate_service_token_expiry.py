from __future__ import annotations

import argparse

from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore


def main() -> int:
    parser = argparse.ArgumentParser(description="Give legacy service tokens a bounded grace period.")
    parser.add_argument("--grace-days", type=int, default=30)
    args = parser.parse_args()
    if args.grace_days < 1 or args.grace_days > 365:
        raise SystemExit("grace-days must be between 1 and 365")
    store = AuthStore(Settings())
    updated = store.backfill_mcp_service_token_expiry(args.grace_days * 24 * 60 * 60)
    print("status=ok")
    print(f"tokens_backfilled={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


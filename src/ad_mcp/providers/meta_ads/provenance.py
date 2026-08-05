from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def live_meta_payload(
    payload: dict[str, Any],
    *,
    source_api: str = "meta_graph_api",
    real_data: bool = True,
    data_status: str = "real",
) -> dict[str, Any]:
    return {
        **payload,
        "source_api": source_api,
        "real_data": real_data,
        "data_status": data_status,
        "fetched_at": datetime.now(UTC).isoformat(),
        "preview": False,
    }

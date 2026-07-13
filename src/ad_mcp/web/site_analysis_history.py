from __future__ import annotations

import json
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ad_mcp.core.secure_files import write_private_json
from ad_mcp.settings import Settings


class SiteAnalysisHistoryStore:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()
        self.path = self.settings.project_root / "tokens" / "site_analysis_history.json"
        self._lock = threading.Lock()

    def list_for_user(self, user_id: str, *, limit: int = 5) -> list[dict[str, Any]]:
        data = self._read()
        items = data.get(str(user_id), [])
        return list(items)[: max(1, min(10, int(limit or 5)))]

    def save(self, user_id: str, analysis: dict[str, Any]) -> dict[str, Any]:
        record = {
            "id": uuid.uuid4().hex,
            "created_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "url": analysis.get("url", ""),
            "status": analysis.get("status", "unknown"),
            "overall_score": analysis.get("overall_score"),
            "summary": analysis.get("summary", ""),
            "analysis": analysis,
        }
        with self._lock:
            data = self._read()
            items = [record, *list(data.get(str(user_id), []))]
            data[str(user_id)] = items[:5]
            self._write(data)
        return record

    def _read(self) -> dict[str, list[dict[str, Any]]]:
        if not self.path.exists():
            return {}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return payload if isinstance(payload, dict) else {}

    def _write(self, payload: dict[str, list[dict[str, Any]]]) -> None:
        write_private_json(self.path, payload)

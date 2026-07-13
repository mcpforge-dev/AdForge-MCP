from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ad_mcp.core.redaction import redact_secrets
from ad_mcp.core.secure_files import restrict_file_to_owner


class AuditLogger:
    def __init__(self, path: Path) -> None:
        self.path = path

    def log(self, event_type: str, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            "payload": redact_secrets(payload),
        }
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=True) + "\n")
        restrict_file_to_owner(self.path)

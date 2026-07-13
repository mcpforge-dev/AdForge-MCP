from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any


PRIVATE_FILE_MODE = stat.S_IRUSR | stat.S_IWUSR


def restrict_file_to_owner(path: Path) -> None:
    """Best-effort private permissions for runtime files with client data."""
    try:
        os.chmod(path, PRIVATE_FILE_MODE)
    except OSError:
        return


def write_private_json(path: Path, payload: Any, *, sort_keys: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=sort_keys), encoding="utf-8")
        restrict_file_to_owner(tmp_path)
        tmp_path.replace(path)
        restrict_file_to_owner(path)
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass

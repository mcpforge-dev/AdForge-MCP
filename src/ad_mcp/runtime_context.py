from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator


_current_workspace_id: ContextVar[str | None] = ContextVar("ad_mcp_current_workspace_id", default=None)


def current_workspace_id() -> str | None:
    value = _current_workspace_id.get()
    return value.strip() if isinstance(value, str) and value.strip() else None


def set_current_workspace_id(workspace_id: str | None) -> Token[str | None]:
    clean = workspace_id.strip() if isinstance(workspace_id, str) and workspace_id.strip() else None
    return _current_workspace_id.set(clean)


def reset_current_workspace_id(token: Token[str | None]) -> None:
    _current_workspace_id.reset(token)


@contextmanager
def workspace_scope(workspace_id: str | None) -> Iterator[None]:
    token = set_current_workspace_id(workspace_id)
    try:
        yield
    finally:
        reset_current_workspace_id(token)

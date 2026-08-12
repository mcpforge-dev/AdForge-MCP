from __future__ import annotations

import re
from typing import Any


SECRET_KEY_MARKERS = (
    "access_token",
    "refresh_token",
    "client_secret",
    "app_secret",
    "developer_token",
    "oauth_client_secret",
    "authorization",
    "api_key",
    "password",
    "secret",
    "token",
    "code",
)

SECRET_TEXT_PATTERN = re.compile(
    r"(?i)\b(access_token|refresh_token|client_secret|app_secret|developer_token|oauth_client_secret|authorization|api_key|password|secret|token|code)=([^&\s'\"<>]+)"
)

SECRET_JSON_PATTERN = re.compile(
    r"(?i)([\"'](?:access_token|refresh_token|client_secret|app_secret|developer_token|oauth_client_secret|authorization|api_key|password|secret|token|code)[\"']\s*:\s*[\"']?)([^,}\s'\"]+)"
)

BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")


def redact_secret_text(text: Any) -> str:
    value = str(text or "")
    value = SECRET_TEXT_PATTERN.sub(r"\1=***REDACTED***", value)
    value = SECRET_JSON_PATTERN.sub(r"\1***REDACTED***", value)
    return BEARER_PATTERN.sub("Bearer ***REDACTED***", value)


def redact_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(marker in key_text for marker in SECRET_KEY_MARKERS):
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = redact_secrets(item)
        return redacted
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_secrets(item) for item in value)
    if isinstance(value, str):
        return redact_secret_text(value)
    return value

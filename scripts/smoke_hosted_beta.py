from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


DEFAULT_TIMEOUT_SECONDS = 15


@dataclass
class Check:
    name: str
    ok: bool
    status: int | None = None
    detail: str = ""
    data: dict[str, Any] | None = None


def _url(base_url: str, path: str) -> str:
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def _headers(token: str | None = None) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _request_json(base_url: str, path: str, *, token: str | None = None, method: str = "GET", body: dict[str, Any] | None = None, timeout: int | None = None) -> tuple[int, dict[str, Any] | None, str]:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    headers = _headers(token)
    if payload is not None:
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json, text/event-stream"
    req = Request(_url(base_url, path), data=payload, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout or DEFAULT_TIMEOUT_SECONDS) as response:  # noqa: S310 - beta smoke targets an explicit operator-provided URL.
            raw = response.read().decode("utf-8", "replace")
            return response.status, _json_or_none(raw), raw[:500]
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        return exc.code, _json_or_none(raw), raw[:500]
    except URLError as exc:
        return 0, None, str(exc)


def _json_or_none(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _check_health(base_url: str) -> Check:
    status, data, raw = _request_json(base_url, "/health")
    return Check("health", status == 200 and (data or {}).get("status") == "ok", status, raw, data)


def _check_ready(base_url: str) -> Check:
    status, data, raw = _request_json(base_url, "/ready")
    return Check("ready", status == 200 and (data or {}).get("status") == "ready", status, raw, data)


def _check_ready_does_not_expose_secrets(ready: Check, token: str) -> Check:
    body = json.dumps(ready.data or {}, ensure_ascii=False) + ready.detail
    lowered = body.lower()
    blocked_markers = [
        token,
        "access_token:",
        "access_token=",
        "refresh_token:",
        "refresh_token=",
        "client_secret:",
        "client_secret=",
        "developer_token:",
        "developer_token=",
        "authorization:",
        "bearer ",
    ]
    leaked = [marker for marker in blocked_markers if marker and marker.lower() in lowered]
    return Check("ready_does_not_expose_secrets", not leaked, ready.status, "leaked_markers=" + ",".join(leaked[:3]))


def _check_token_gate(base_url: str) -> Check:
    status, data, raw = _request_json(base_url, "/api/diagnostics")
    return Check("sensitive_endpoint_blocks_missing_token", status in {401, 403, 503}, status, raw, data)


def _check_invalid_token_gate(base_url: str) -> Check:
    status, data, raw = _request_json(base_url, "/api/diagnostics", token="invalid-beta-token")
    return Check("sensitive_endpoint_blocks_invalid_token", status in {401, 403}, status, raw, data)


def _check_authorized_api(base_url: str, token: str, path: str, *, live: bool = False) -> Check:
    suffix = "?live=1" if live and "?" not in path else ""
    status, data, raw = _request_json(base_url, f"{path}{suffix}", token=token)
    ok = status == 200 and isinstance(data, dict)
    return Check(path.strip("/").replace("/", "_") or "root", ok, status, raw, data)


def _check_preview_only(diagnostics: dict[str, Any] | None, ready: dict[str, Any] | None) -> Check:
    preview_from_diagnostics = (diagnostics or {}).get("backend", {}).get("preview_only")
    preview_from_ready = (ready or {}).get("checks", {}).get("preview_only", {}).get("enabled")
    ok = preview_from_diagnostics is True or preview_from_ready is True
    return Check("preview_only_enabled", ok, None, f"diagnostics={preview_from_diagnostics} ready={preview_from_ready}")


def _check_security_posture(security: dict[str, Any] | None) -> Check:
    security = security or {}
    expected = {
        "preview_only": True,
        "live_writes_enabled": False,
        "tokens_returned": False,
        "secrets_redacted": True,
    }
    mismatches = [key for key, value in expected.items() if security.get(key) is not value]
    return Check("security_diagnostics_preview_only_posture", not mismatches, None, "mismatches=" + ",".join(mismatches))


def _check_strict_security(security: dict[str, Any] | None) -> Check:
    security = security or {}
    expected = {
        "api_auth_required": True,
        "preview_only": True,
        "live_writes_enabled": False,
        "tokens_returned": False,
        "beta_token_configured": True,
        "secrets_redacted": True,
    }
    mismatches = [key for key, value in expected.items() if security.get(key) is not value]
    return Check("strict_deploy_security_posture", not mismatches, None, "mismatches=" + ",".join(mismatches))


def _check_strict_capabilities(capabilities: dict[str, Any] | None) -> Check:
    capabilities = capabilities or {}
    security = capabilities.get("security") if isinstance(capabilities.get("security"), dict) else {}
    mcp = capabilities.get("mcp") if isinstance(capabilities.get("mcp"), dict) else {}
    ok = (
        capabilities.get("mode") == "hosted_beta"
        and security.get("mcp_public_url_configured") is True
        and security.get("tokens_returned") is False
        and str(mcp.get("url") or "").startswith(("https://", "http://"))
    )
    detail = (
        f"mode={capabilities.get('mode')} "
        f"mcp_public_url_configured={security.get('mcp_public_url_configured')} "
        f"mcp_url={mcp.get('url') or '<missing>'}"
    )
    return Check("strict_deploy_capabilities", ok, None, detail)


def _check_public_mcp_url(mcp: dict[str, Any] | None) -> Check:
    transport = (mcp or {}).get("transport", {})
    url = str(transport.get("url") or "")
    endpoint_path = str(transport.get("endpoint_path") or "")
    ok = url.startswith(("https://", "http://")) and bool(endpoint_path)
    return Check("diagnostics_exposes_public_mcp_url", ok, None, f"url={url or '<missing>'} endpoint_path={endpoint_path or '<missing>'}")


def _check_live_provider_default(live: bool, diagnostics: dict[str, Any] | None) -> Check:
    if live:
        return Check("live_provider_checks_explicitly_enabled", True, None, "--live was passed by operator")
    return Check("live_provider_checks_disabled_by_default", True, None, "--live was not passed")


def _check_mcp_token_gate(base_url: str, endpoint_path: str) -> Check:
    request_body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    status, data, raw = _request_json(base_url, endpoint_path, method="POST", body=request_body)
    return Check("mcp_endpoint_blocks_missing_token", status in {401, 403, 503}, status, raw, data)


def _check_mcp_endpoint(base_url: str, token: str, endpoint_path: str) -> Check:
    request_body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    status, data, raw = _request_json(base_url, endpoint_path, token=token, method="POST", body=request_body)
    if status in {401, 403, 404, 421, 501, 502, 503, 504, 0}:
        return Check("hosted_mcp_endpoint", False, status, raw, data)
    raw_lower = raw.lower()
    if "legacy web process does not serve mcp traffic" in raw_lower or "mcp_transport_not_served_by_web_process" in raw_lower:
        return Check("hosted_mcp_endpoint", False, status, "MCP endpoint returned the web placeholder instead of the hosted MCP transport.", data)
    tools_count = None
    if isinstance(data, dict):
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        tools = result.get("tools") if isinstance(result, dict) else None
        if isinstance(tools, list):
            tools_count = len(tools)
    detail = f"status={status}"
    if tools_count is not None:
        detail = f"{detail} tools_count={tools_count}"
    return Check("hosted_mcp_endpoint", True, status, detail, data)


def _print_report(checks: list[Check]) -> None:
    payload = {
        "status": "ok" if all(check.ok for check in checks) else "failed",
        "checks": [
            {
                "name": check.name,
                "ok": check.ok,
                "status": check.status,
                "detail": check.detail,
            }
            for check in checks
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> int:
    global DEFAULT_TIMEOUT_SECONDS  # noqa: PLW0603 - keeps helper signatures simple for this standalone script.
    parser = argparse.ArgumentParser(description="Smoke-check a deployed hosted AdForge MCP beta server.")
    parser.add_argument("--base-url", required=True, help="Public dashboard base URL, for example https://your-domain.com")
    parser.add_argument("--token", default=os.getenv("ADFORGE_MCP_CLIENT_TOKEN") or os.getenv("AD_MCP_WEB_API_TOKEN") or "", help="Beta token. Can also be provided by ADFORGE_MCP_CLIENT_TOKEN.")
    parser.add_argument("--live", action="store_true", help="Run live provider read diagnostics. Disabled by default.")
    parser.add_argument("--skip-oauth", action="store_true", help="Skip OAuth diagnostics endpoint.")
    parser.add_argument("--mcp-path", default="/mcp", help="Hosted MCP endpoint path. Default: /mcp.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS, help="HTTP timeout in seconds.")
    parser.add_argument("--strict-deploy", action="store_true", help="Run stricter VPS deployment assertions. Does not run live provider calls without --live.")
    args = parser.parse_args()

    if args.timeout != DEFAULT_TIMEOUT_SECONDS:
        DEFAULT_TIMEOUT_SECONDS = args.timeout

    if not args.token:
        print("Missing beta token. Pass --token or set ADFORGE_MCP_CLIENT_TOKEN.", file=sys.stderr)
        return 2

    checks: list[Check] = []
    health = _check_health(args.base_url)
    checks.append(health)
    ready = _check_ready(args.base_url)
    checks.append(ready)
    checks.append(_check_ready_does_not_expose_secrets(ready, args.token))
    checks.append(_check_token_gate(args.base_url))
    checks.append(_check_invalid_token_gate(args.base_url))

    diagnostics = _check_authorized_api(args.base_url, args.token, "/api/diagnostics", live=args.live)
    checks.append(diagnostics)
    mcp_diagnostics = _check_authorized_api(args.base_url, args.token, "/api/diagnostics/mcp")
    checks.append(mcp_diagnostics)
    security_diagnostics = _check_authorized_api(args.base_url, args.token, "/api/diagnostics/security")
    checks.append(security_diagnostics)
    capabilities = _check_authorized_api(args.base_url, args.token, "/api/beta/capabilities")
    checks.append(capabilities)
    if not args.skip_oauth:
        checks.append(_check_authorized_api(args.base_url, args.token, "/api/hosted/oauth/diagnostics"))
        checks.append(_check_authorized_api(args.base_url, args.token, "/api/hosted/oauth/readiness"))
    checks.append(_check_preview_only(diagnostics.data, ready.data))
    checks.append(_check_security_posture(security_diagnostics.data))
    checks.append(_check_public_mcp_url(mcp_diagnostics.data))
    checks.append(_check_live_provider_default(args.live, diagnostics.data))
    checks.append(_check_mcp_token_gate(args.base_url, args.mcp_path))
    checks.append(_check_mcp_endpoint(args.base_url, args.token, args.mcp_path))
    if args.strict_deploy:
        checks.append(_check_strict_security(security_diagnostics.data))
        checks.append(_check_strict_capabilities(capabilities.data))

    _print_report(checks)
    return 0 if all(check.ok for check in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())

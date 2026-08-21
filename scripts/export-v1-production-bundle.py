#!/usr/bin/env python3
"""Export a sanitized V1 production snapshot for an isolated V2 rehearsal.

The exporter reads the database through ``psql`` and the V1 connection store
from the already running service environment. It emits identifiers, hashes,
safe account metadata, and existing encrypted credential envelopes only.
Plaintext credential fields are rejected before the bundle is written.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit


SAFE_ACCOUNT_KEYS = {
    "account_id",
    "customer_id",
    "advertiser_id",
    "name",
    "currency",
    "timezone_name",
    "timezone",
    "status",
    "google_ads_account_type",
    "google_ads_level",
    "google_ads_status",
    "login_customer_id",
    "manager_customer_id",
    "meta_account_status",
    "business_id",
    "business_name",
    "page_id",
    "page_name",
    "instagram_account_id",
    "instagram_username",
    "requested_permissions",
    "granted_permissions",
    "declined_permissions",
    "scope",
    "login",
    "direct_client_login",
}
SECRET_KEYS = {
    "access_token",
    "accessToken",
    "refresh_token",
    "refreshToken",
    "client_secret",
    "clientSecret",
    "app_secret",
    "developer_token",
    "developerToken",
    "page_access_tokens",
    "credentials",
    "password",
    "cookie",
    "private_key",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--service-pid", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        raise SystemExit("Refusing to write a production snapshot without --apply.")

    env = service_environment(args.service_pid)
    database_url = env.get("AD_MCP_DATABASE_URL", "")
    store_path = Path(env.get("AD_MCP_CONNECTION_STORE_PATH", ""))
    if not database_url or not store_path.is_file():
        raise SystemExit("Running service environment or connection store is unavailable.")

    rows = {table: psql_rows(database_url, table) for table in TABLE_COLUMNS}
    store = json.loads(store_path.read_text(encoding="utf-8"))
    bundle = build_bundle(rows, store)
    reject_plaintext(bundle)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.output.chmod(0o600)
    print(json.dumps({"status": "exported", "secretOutput": "none", "counts": summary(bundle)}))
    return 0


TABLE_COLUMNS = {
    "users": ["id", "email", "name", "password_hash", "status", "created_at", "updated_at", "last_login_at"],
    "workspaces": ["id", "name", "status", "created_at", "updated_at"],
    "workspace_members": ["id", "workspace_id", "user_id", "role", "created_at"],
    "platform_connections": ["id", "workspace_id", "user_id", "platform", "status", "created_at", "updated_at", "last_success_at", "last_error_code", "last_error_message"],
    "selected_ad_accounts": ["id", "connection_id", "platform", "account_id", "account_name", "status", "created_at", "updated_at"],
    "mcp_service_tokens": ["id", "workspace_id", "token_hash", "token_prefix", "name", "scope", "allowed_accounts_json", "status", "created_at", "last_used_at", "revoked_at", "expires_at"],
    "mcp_access_tokens": ["id", "user_id", "workspace_id", "token_hash", "token_prefix", "name", "status", "created_at", "last_used_at", "revoked_at"],
    "mcp_oauth_clients": ["client_id", "client_name", "redirect_uris_json", "scope", "token_endpoint_auth_method", "created_at"],
    "mcp_oauth_client_credentials": ["client_id", "user_id", "workspace_id", "client_secret_hash", "client_secret_prefix", "status", "created_at", "revoked_at"],
}


def service_environment(pid: str) -> dict[str, str]:
    raw = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    return {
        item.split(b"=", 1)[0].decode(): item.split(b"=", 1)[1].decode()
        for item in raw
        if b"=" in item
    }


def psql_rows(database_url: str, table: str) -> list[dict[str, Any]]:
    columns = TABLE_COLUMNS[table]
    uri = urlsplit(database_url)
    child_env = os.environ.copy()
    child_env.update(
        {
            "PGHOST": uri.hostname or "",
            "PGPORT": str(uri.port or 5432),
            "PGUSER": unquote(uri.username or ""),
            "PGPASSWORD": unquote(uri.password or ""),
            "PGDATABASE": (uri.path or "/").lstrip("/"),
        }
    )
    selected = ", ".join(f'"{column}"' for column in columns)
    query = f"SELECT COALESCE(json_agg(row_to_json(rows)), '[]'::json) FROM (SELECT {selected} FROM \"{table}\") rows"
    result = subprocess.run(
        ["psql", "--no-psqlrc", "-At", "-c", query],
        env=child_env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    if result.returncode:
        raise SystemExit(f"Unable to export table {table}.")
    value = json.loads(result.stdout or "[]")
    return value if isinstance(value, list) else []


def build_bundle(rows: dict[str, list[dict[str, Any]]], store: dict[str, Any]) -> dict[str, Any]:
    users = rows["users"]
    workspaces = rows["workspaces"]
    workspace_ids = {str(row["id"]) for row in workspaces}
    connections_by_scope: dict[tuple[str, str], dict[str, Any]] = {}
    store_workspaces = store.get("workspaces", {})
    for workspace_id, root in store_workspaces.items() if isinstance(store_workspaces, dict) else []:
        if not isinstance(root, dict):
            continue
        for provider, connection in (root.get("connections", {}) or {}).items():
            if isinstance(connection, dict):
                connections_by_scope[(str(workspace_id), normalize_provider(provider))] = connection

    selected_by_connection: dict[str, list[dict[str, Any]]] = {}
    for row in rows["selected_ad_accounts"]:
        selected_by_connection.setdefault(str(row["connection_id"]), []).append(row)

    connections: list[dict[str, Any]] = []
    for row in rows["platform_connections"]:
        workspace_id = str(row["workspace_id"])
        provider = normalize_provider(row["platform"])
        stored = connections_by_scope.get((workspace_id, provider), {})
        accounts = safe_accounts(stored, selected_by_connection.get(str(row["id"]), []))
        credential = encrypted_credential(stored)
        reconnect_required = (
            credential is None
            and str(row.get("status") or "").lower() in {"connected", "active"}
        )
        item: dict[str, Any] = {
            "id": str(row["id"]),
            "workspace_id": workspace_id,
            "user_id": str(row["user_id"]) if row.get("user_id") else None,
            "provider": provider,
            "status": row.get("status") or "connected",
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "last_success_at": row.get("last_success_at"),
            "last_error_code": row.get("last_error_code"),
            "credential_present": credential is not None,
            "reconnect_required": reconnect_required,
            "accounts": accounts,
        }
        if credential is not None:
            item["credential"] = credential
        connections.append(item)

    used_slugs: set[str] = set()
    exported_workspaces: list[dict[str, Any]] = []
    for row in workspaces:
        source_id = str(row["id"])
        base_slug = workspace_slug(str(row["name"]), source_id)
        slug = base_slug
        if slug in used_slugs:
            slug = f"{base_slug}-{source_id[:8]}"[:120]
        suffix = 1
        while slug in used_slugs:
            suffix += 1
            slug = f"{base_slug[: max(1, 120 - len(str(suffix)) - 1)]}-{suffix}"
        used_slugs.add(slug)
        exported_workspaces.append({**row, "slug": slug})

    return {
        "schema_version": 1,
        "source": {"system": "v1", "export": "sanitized", "database_engine": "postgresql"},
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "users": users,
        "workspaces": exported_workspaces,
        "memberships": rows["workspace_members"],
        "connections": connections,
        "service_tokens": service_tokens(rows),
        "mcp_oauth_clients": oauth_clients(rows),
        "entitlements": [],
        "export_diagnostics": {
            "db_connections": len(rows["platform_connections"]),
            "store_connections": len(connections_by_scope),
            "unmatched_store_connections": max(0, len(connections_by_scope) - len(connections)),
            "unsupported_plaintext_credentials": 0,
        },
    }


def safe_accounts(connection: dict[str, Any], selected: list[dict[str, Any]]) -> list[dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    raw_accounts = connection.get("accounts", [])
    if isinstance(raw_accounts, list):
        for raw in raw_accounts:
            if not isinstance(raw, dict):
                continue
            external_id = str(raw.get("account_id") or raw.get("customer_id") or raw.get("advertiser_id") or "").strip()
            if not external_id:
                continue
            values[external_id] = safe_account(raw, external_id)
    for row in selected:
        external_id = str(row.get("account_id") or "").strip()
        if external_id and external_id not in values:
            values[external_id] = {
                "external_account_id": external_id,
                "display_name": str(row.get("account_name") or external_id)[:255],
                "status": str(row.get("status") or "active"),
                "enabled": str(row.get("status") or "").lower() not in {"disabled", "revoked"},
            }
    return list(values.values())


def safe_account(raw: dict[str, Any], external_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {"external_account_id": external_id, "enabled": True}
    for key in SAFE_ACCOUNT_KEYS:
        if key in raw and isinstance(raw[key], (str, int, float, bool, list)):
            result[key if key not in {"name", "timezone_name"} else {"name": "display_name", "timezone_name": "timezone"}[key]] = raw[key]
    if str(raw.get("status", "")).lower() in {"disabled", "revoked", "deactivated"}:
        result["enabled"] = False
    return result


def encrypted_credential(connection: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[str] = []
    accounts = connection.get("accounts", [])
    if isinstance(accounts, list):
        for account in accounts:
            if not isinstance(account, dict):
                continue
            if any(key in account and account[key] for key in SECRET_KEYS):
                raise SystemExit("Plaintext credential field detected in V1 connection store.")
            encrypted = account.get("credentials_encrypted")
            if encrypted:
                if not isinstance(encrypted, str) or not encrypted.startswith("v1:"):
                    raise SystemExit("Unsupported V1 credential envelope detected.")
                candidates.append(encrypted)
    if not candidates:
        return None
    return {"encryption_version": 1, "encrypted_payload": candidates[0]}


def service_tokens(rows: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows["mcp_service_tokens"]:
        result.append(
            {
                "id": f"mcp-service:{row['id']}",
                "service_identity_id": f"v1-service:{row['workspace_id']}",
                "workspace_id": str(row["workspace_id"]),
                "token_digest": str(row.get("token_hash") or ""),
                "token_prefix": row.get("token_prefix"),
                "name": row.get("name"),
                "scopes": [row.get("scope") or "adforge:mcp:read"],
                "account_ids": parse_json(row.get("allowed_accounts_json"), []),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "last_used_at": row.get("last_used_at"),
                "revoked_at": row.get("revoked_at"),
                "expires_at": row.get("expires_at"),
            }
        )
    for row in rows["mcp_access_tokens"]:
        result.append(
            {
                "id": f"mcp-access:{row['id']}",
                "service_identity_id": f"v1-legacy-access:{row['workspace_id']}",
                "workspace_id": str(row["workspace_id"]),
                "token_digest": str(row.get("token_hash") or ""),
                "token_prefix": row.get("token_prefix"),
                "name": row.get("name") or "Migrated V1 access token",
                "scopes": ["adforge:mcp:read"],
                "account_ids": [],
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "last_used_at": row.get("last_used_at"),
                "revoked_at": row.get("revoked_at"),
            }
        )
    return result


def oauth_clients(rows: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    credentials = {str(row["client_id"]): row for row in rows["mcp_oauth_client_credentials"]}
    result: list[dict[str, Any]] = []
    for row in rows["mcp_oauth_clients"]:
        credential = credentials.get(str(row["client_id"]))
        if not credential or not re.fullmatch(r"[a-fA-F0-9]{64}", str(credential.get("client_secret_hash") or "")):
            continue
        result.append(
            {
                "id": f"v1-mcp-client:{row['client_id']}",
                "workspace_id": str(credential["workspace_id"]),
                "user_id": str(credential["user_id"]),
                "client_id": str(row["client_id"]),
                "client_secret_digest": str(credential["client_secret_hash"]),
                "client_secret_prefix": credential.get("client_secret_prefix"),
                "client_name": row.get("client_name"),
                "redirect_uris": parse_json(row.get("redirect_uris_json"), []),
                "scope": row.get("scope") or "adforge:mcp:read",
                "status": credential.get("status"),
                "created_at": row.get("created_at"),
                "revoked_at": credential.get("revoked_at"),
            }
        )
    return result


def parse_json(value: Any, fallback: Any) -> Any:
    if not isinstance(value, str):
        return value if value is not None else fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def normalize_provider(value: Any) -> str:
    return str(value or "").strip().upper().replace("-", "_")


def workspace_slug(name: str, source_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:110]
    return slug or f"workspace-{source_id[:8]}"


def reject_plaintext(value: Any, path: str = "bundle") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in SECRET_KEYS:
                raise SystemExit(f"Plaintext credential field detected at {path}.{key}.")
            reject_plaintext(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_plaintext(child, f"{path}[{index}]")


def summary(bundle: dict[str, Any]) -> dict[str, int]:
    return {
        "users": len(bundle.get("users", [])),
        "workspaces": len(bundle.get("workspaces", [])),
        "memberships": len(bundle.get("memberships", [])),
        "connections": len(bundle.get("connections", [])),
        "accounts": sum(len(item.get("accounts", [])) for item in bundle.get("connections", [])),
        "service_tokens": len(bundle.get("service_tokens", [])),
        "mcp_oauth_clients": len(bundle.get("mcp_oauth_clients", [])),
    }


if __name__ == "__main__":
    raise SystemExit(main())

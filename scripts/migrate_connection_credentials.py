from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ad_mcp.core.connection_store import SECRET_KEYS
from ad_mcp.core.credential_crypto import CredentialCipher, CredentialEncryptionError
from ad_mcp.core.secure_files import write_private_json


def _encrypt_record(record: dict[str, Any], cipher: CredentialCipher) -> bool:
    changed = False
    credentials = record.get("credentials") if isinstance(record.get("credentials"), dict) else {}
    encrypted = record.get("credentials_encrypted")
    if encrypted:
        if credentials:
            raise CredentialEncryptionError("Record contains both encrypted and plaintext credentials.")
        return False
    direct = {key: record.pop(key) for key in list(record) if key in SECRET_KEYS}
    if direct:
        credentials = {**credentials, **direct}
        changed = True
    if credentials:
        record["credentials_encrypted"] = cipher.encrypt_dict(credentials)
        record.pop("credentials", None)
        changed = True
    return changed


def _migrate_root(root: dict[str, Any], cipher: CredentialCipher) -> int:
    changed = 0
    connections = root.get("connections")
    if isinstance(connections, dict):
        for connection in connections.values():
            if not isinstance(connection, dict):
                continue
            changed += int(_encrypt_record(connection, cipher))
            accounts = connection.get("accounts")
            if isinstance(accounts, list):
                for account in accounts:
                    if isinstance(account, dict):
                        changed += int(_encrypt_record(account, cipher))
    pending_root = root.get("oauth_pending")
    if isinstance(pending_root, dict):
        for provider_pending in pending_root.values():
            if not isinstance(provider_pending, dict):
                continue
            for pending in provider_pending.values():
                if not isinstance(pending, dict):
                    continue
                changed += int(_encrypt_record(pending, cipher))
                accounts = pending.get("accounts")
                if isinstance(accounts, list):
                    for account in accounts:
                        if isinstance(account, dict):
                            changed += int(_encrypt_record(account, cipher))
    return changed


def migrate_data(data: dict[str, Any], cipher: CredentialCipher) -> tuple[dict[str, Any], int]:
    changed = _migrate_root(data, cipher)
    workspaces = data.get("workspaces")
    if isinstance(workspaces, dict):
        for workspace in workspaces.values():
            if isinstance(workspace, dict):
                changed += _migrate_root(workspace, cipher)
    return data, changed


def _assert_no_plaintext(data: dict[str, Any]) -> None:
    encoded = json.dumps(data, ensure_ascii=False)
    if '"credentials"' in encoded:
        raise CredentialEncryptionError("Plaintext credentials remain in the connection store.")
    for key in SECRET_KEYS:
        if f'"{key}"' in encoded:
            raise CredentialEncryptionError("Plaintext credential field remains in the connection store.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Encrypt provider credentials in a connection store.")
    parser.add_argument("--path", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="Write the encrypted store; otherwise perform a dry run.")
    parser.add_argument("--backup-path", type=Path)
    args = parser.parse_args()

    key = os.getenv("AD_MCP_CREDENTIALS_ENCRYPTION_KEY", "").strip()
    if not key:
        raise SystemExit("Credential encryption key is not configured.")
    cipher = CredentialCipher(key)
    if not args.path.exists():
        print("status=missing_store")
        return 0
    data = json.loads(args.path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("Connection store root must be an object.")
    migrated, changed = migrate_data(data, cipher)
    _assert_no_plaintext(migrated)
    print(f"status={'apply' if args.apply else 'dry_run'}")
    print(f"records_changed={changed}")
    if not args.apply or changed == 0:
        return 0

    backup_path = args.backup_path or args.path.with_name(
        f"{args.path.name}.pre-encryption.{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.enc"
    )
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    encrypted_backup = cipher.encrypt(data)
    backup_path.write_text(encrypted_backup, encoding="ascii")
    try:
        backup_path.chmod(0o600)
    except OSError:
        pass
    write_private_json(args.path, migrated, sort_keys=True)
    print("backup=encrypted")
    print("plaintext_credentials=absent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

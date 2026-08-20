from __future__ import annotations

import json

from cryptography.fernet import Fernet

from ad_mcp.core.credential_crypto import CredentialCipher
from scripts.migrate_connection_credentials import _assert_no_plaintext, migrate_data


def test_migration_encrypts_workspace_connection_and_pending_credentials() -> None:
    data = {
        "workspaces": {
            "workspace-a": {
                "connections": {
                    "meta_ads": {
                        "provider": "meta_ads",
                        "app_secret": "provider-secret",
                        "accounts": [{"account_id": "act_123", "access_token": "account-token"}],
                    }
                },
                "oauth_pending": {
                    "meta_ads": {
                        "pending": {
                            "credentials": {"access_token": "pending-token"},
                            "accounts": [{"account_id": "act_123", "app_secret": "pending-secret"}],
                        }
                    }
                },
            }
        }
    }
    cipher = CredentialCipher(Fernet.generate_key())

    migrated, changed = migrate_data(data, cipher)

    assert changed == 4
    _assert_no_plaintext(migrated)
    serialized = json.dumps(migrated)
    assert "provider-secret" not in serialized
    assert "account-token" not in serialized
    assert "pending-token" not in serialized
    assert "pending-secret" not in serialized

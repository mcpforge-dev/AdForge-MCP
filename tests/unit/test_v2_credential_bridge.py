from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

from cryptography.fernet import Fernet


ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "scripts" / "v1-credential-bridge.py"


def test_v1_fernet_bridge_emits_only_v2_ciphertext(tmp_path: Path) -> None:
    v1_key = Fernet.generate_key()
    v2_key = b"2" * 32
    plaintext = {"access_token": "synthetic-token", "expires_at": 123}
    bundle = {
        "schema_version": 1,
        "connections": [
            {
                "id": "connection-1",
                "workspace_id": "workspace-1",
                "provider": "google_ads",
                "credential": {
                    "encrypted_payload": "v1:"
                    + Fernet(v1_key)
                    .encrypt(json.dumps(plaintext).encode("utf-8"))
                    .decode("ascii"),
                    "encryption_version": 1,
                },
            }
        ],
    }
    source = tmp_path / "source.json"
    result = tmp_path / "result.json"
    source.write_text(json.dumps(bundle), encoding="utf-8")

    env = os.environ.copy()
    env.update(
        {
            "V1_CREDENTIALS_ENCRYPTION_KEY": v1_key.decode("ascii"),
            "V2_PROVIDER_CREDENTIAL_KEY_B64": base64.b64encode(v2_key).decode("ascii"),
            "V2_PROVIDER_CREDENTIAL_KEY_VERSION": "1",
        }
    )
    completed = subprocess.run(
        [sys.executable, str(BRIDGE), "--input", str(source), "--output", str(result), "--apply"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )

    assert json.loads(completed.stdout) == {
        "status": "converted",
        "credentials": 1,
        "secretOutput": "none",
    }
    converted = json.loads(result.read_text(encoding="utf-8"))
    encrypted = converted["connections"][0]["credential"]["encrypted_payload"]
    assert encrypted.startswith("hm1.")
    serialized = result.read_text(encoding="utf-8")
    assert "synthetic-token" not in serialized
    assert "access_token" not in serialized

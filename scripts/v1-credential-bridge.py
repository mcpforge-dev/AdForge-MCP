"""One-time in-memory V1 Fernet -> V2 AES-GCM credential bridge.

The input and output are migration bundles, not production stores. The
script never writes decrypted credentials to disk or stdout. It accepts only
V1 ``v1:`` ciphertext envelopes and emits V2 ``hm1.`` envelopes.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import secrets
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.fernet import Fernet


SECRET_KEYS = {
    "access_token",
    "accessToken",
    "refresh_token",
    "refreshToken",
    "client_secret",
    "clientSecret",
    "app_secret",
    "appSecret",
    "developer_token",
    "developerToken",
    "raw_token",
    "rawToken",
    "oauth_client_secret",
    "oauthClientSecret",
    "credentials",
    "password",
    "cookie",
    "private_key",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if not args.apply:
        raise SystemExit("Refusing to write credentials without --apply.")
    if args.input.resolve() == args.output.resolve():
        raise SystemExit("Input and output must be different files.")

    fernet_key = os.getenv("V1_CREDENTIALS_ENCRYPTION_KEY", "").strip()
    v2_key = _read_v2_key()
    if not fernet_key or not v2_key:
        raise SystemExit("Migration keys must be supplied through the environment.")

    bundle = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(bundle, dict):
        raise SystemExit("Migration bundle root must be an object.")
    _reject_plaintext(bundle)
    fernet = Fernet(fernet_key.encode("ascii"))
    output = copy.deepcopy(bundle)
    converted = 0
    for connection in _connections(output):
        credential = connection.get("credential")
        if not isinstance(credential, dict):
            continue
        encrypted = credential.get("encrypted_payload") or credential.get(
            "encryptedPayload"
        )
        if not isinstance(encrypted, str) or not encrypted.startswith("v1:"):
            continue
        plaintext = fernet.decrypt(encrypted[3:].encode("ascii"))
        payload = json.loads(plaintext.decode("utf-8"))
        if not isinstance(payload, dict):
            raise SystemExit("V1 credential payload must be a JSON object.")
        nonce = secrets.token_bytes(12)
        ciphertext = AESGCM(v2_key).encrypt(
            nonce,
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"),
            None,
        )
        tag, data = ciphertext[-16:], ciphertext[:-16]
        credential["encrypted_payload"] = ".".join(
            ("hm1", _b64(nonce), _b64(tag), _b64(data))
        )
        credential["encryption_version"] = _v2_version()
        converted += 1

    if converted == 0:
        raise SystemExit("No V1 credential envelopes found; no output was written.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    try:
        args.output.chmod(0o600)
    except OSError:
        pass
    print(json.dumps({"status": "converted", "credentials": converted, "secretOutput": "none"}))
    return 0


def _connections(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    values = bundle.get("connections")
    if not isinstance(values, list):
        return []
    return [item for item in values if isinstance(item, dict)]


def _reject_plaintext(value: Any, path: str = "bundle") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in SECRET_KEYS:
                raise SystemExit(f"Plaintext credential field is not allowed: {path}.{key}")
            _reject_plaintext(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_plaintext(child, f"{path}[{index}]")


def _read_v2_key() -> bytes:
    encoded = os.getenv("V2_PROVIDER_CREDENTIAL_KEY_B64", "").strip()
    try:
        key = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        return b""
    return key if len(key) == 32 else b""


def _v2_version() -> int:
    try:
        version = int(os.getenv("V2_PROVIDER_CREDENTIAL_KEY_VERSION", "1"))
    except ValueError:
        raise SystemExit("V2_PROVIDER_CREDENTIAL_KEY_VERSION must be an integer.")
    if version < 1:
        raise SystemExit("V2_PROVIDER_CREDENTIAL_KEY_VERSION must be positive.")
    return version


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


if __name__ == "__main__":
    raise SystemExit(main())

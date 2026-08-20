from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken


class CredentialEncryptionError(RuntimeError):
    """Raised when provider credentials cannot be safely encrypted/decrypted."""


class CredentialCipher:
    """Small envelope-encryption boundary for provider credentials.

    The Fernet key is supplied by the deployment environment. It is never
    persisted alongside the connection store and the ciphertext has an
    explicit version marker so key rotation can be added later.
    """

    VERSION = "v1:"

    def __init__(self, key: str | bytes) -> None:
        raw_key = key.encode("ascii") if isinstance(key, str) else key
        try:
            self._fernet = Fernet(raw_key)
        except (TypeError, ValueError) as exc:
            raise CredentialEncryptionError("Credential encryption key is invalid.") from exc

    def encrypt(self, value: Any) -> str:
        try:
            payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
            return self.VERSION + self._fernet.encrypt(payload).decode("ascii")
        except (TypeError, ValueError) as exc:
            raise CredentialEncryptionError("Credential value is not JSON serializable.") from exc

    def decrypt(self, value: str) -> Any:
        if not isinstance(value, str) or not value.startswith(self.VERSION):
            raise CredentialEncryptionError("Credential ciphertext has an unsupported version.")
        try:
            payload = self._fernet.decrypt(value[len(self.VERSION) :].encode("ascii"))
            return json.loads(payload.decode("utf-8"))
        except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise CredentialEncryptionError("Credential ciphertext could not be decrypted.") from exc

    def encrypt_dict(self, value: dict[str, Any]) -> str:
        return self.encrypt(value)

    def decrypt_dict(self, value: str) -> dict[str, Any]:
        decrypted = self.decrypt(value)
        if not isinstance(decrypted, dict):
            raise CredentialEncryptionError("Credential ciphertext does not contain an object.")
        return decrypted


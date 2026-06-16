from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ad_mcp.settings import Settings  # noqa: E402
from ad_mcp.web.auth_store import AuthStore, AuthValidationError  # noqa: E402


def _read_password(password_env: str) -> str:
    if password_env:
        value = os.getenv(password_env, "")
        if value:
            return value
    first = getpass.getpass("Admin password: ")
    second = getpass.getpass("Repeat admin password: ")
    if first != second:
        raise SystemExit("Passwords do not match.")
    return first


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or promote an AdForge MCP admin user.")
    parser.add_argument("--email", default=os.getenv("AD_MCP_INITIAL_ADMIN_EMAIL", ""), help="Admin email address.")
    parser.add_argument("--name", default="AdForge Admin", help="Admin display name.")
    parser.add_argument(
        "--password-env",
        default="AD_MCP_INITIAL_ADMIN_PASSWORD",
        help="Optional env var containing the password. If empty, password is requested interactively.",
    )
    args = parser.parse_args()

    email = args.email.strip().lower()
    if not email:
        raise SystemExit("Pass --email or set AD_MCP_INITIAL_ADMIN_EMAIL.")

    settings = Settings()
    store = AuthStore(settings)
    store.ensure_schema()
    password = _read_password(args.password_env)

    try:
        user = store.create_user(email=email, name=args.name, password=password, role="admin", status="active")
        print(f"Admin user created: {user.email}")
    except AuthValidationError as exc:
        if "уже существует" not in str(exc):
            raise
        users = store.list_users()
        existing = next((item for item in users if str(item.get("email", "")).lower() == email), None)
        if not existing:
            raise
        store.set_user_role(str(existing["id"]), "admin")
        store.set_user_status(str(existing["id"]), "active")
        print(f"Existing user promoted to admin: {email}")


if __name__ == "__main__":
    main()

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


def is_network_exposed_host(host: str) -> bool:
    return host.strip().lower() in {"0.0.0.0", "::", "[::]"}


def is_strict_auth_env(env: str) -> bool:
    return env.strip().lower() in {"beta", "production"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AD_MCP_", extra="ignore")

    env: str = "development"
    log_level: str = "INFO"
    audit_log_path: str = "logs/audit.jsonl"
    connections_config: str = "ads_config.yaml"
    policy_config: str = "config/policies/safety.example.yaml"
    web_host: str = "127.0.0.1"
    web_port: int = 8765
    web_api_token: str = ""
    web_max_body_bytes: int = 65536
    database_url: str = ""
    auth_enabled: bool = True
    auth_session_cookie_name: str = "adforge_session"
    auth_session_ttl_hours: int = 720
    auth_secure_cookies: bool = False
    auth_allow_public_registration: bool = True
    auth_registration_code: str = ""
    initial_admin_email: str = ""
    auth_rate_limit_window_seconds: int = 900
    auth_login_rate_limit: int = 12
    auth_registration_rate_limit: int = 8
    auth_password_reset_rate_limit: int = 6
    auth_password_change_rate_limit: int = 10
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "AdForge MCP"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    password_reset_ttl_minutes: int = 30
    profile_upload_dir: str = "/var/lib/adforge-mcp/uploads"
    profile_max_avatar_bytes: int = 2_097_152
    preview_only: bool = True
    public_base_url: str = ""
    mcp_public_url: str = ""
    mcp_endpoint_path: str = "/mcp"
    mcp_http_host: str = "127.0.0.1"
    mcp_http_port: int = 8766
    meta_oauth_redirect_path: str = "/oauth/meta/callback"
    google_oauth_redirect_path: str = "/oauth/google/callback"
    tiktok_oauth_redirect_path: str = "/oauth/tiktok/callback"
    yandex_oauth_redirect_path: str = "/oauth/yandex/callback"
    meta_oauth_app_id: str = ""
    meta_oauth_app_secret: str = ""
    meta_oauth_api_version: str = "v20.0"
    meta_oauth_scopes: str = "ads_read,business_management"
    meta_oauth_state_ttl_seconds: int = 900
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_ads_developer_token: str = ""
    google_ads_login_customer_id: str = ""
    google_ads_api_version: str = "v20"
    google_oauth_scopes: str = "https://www.googleapis.com/auth/adwords"
    google_oauth_state_ttl_seconds: int = 900
    tiktok_oauth_app_id: str = ""
    tiktok_oauth_app_secret: str = ""
    tiktok_oauth_auth_url: str = "https://ads.tiktok.com/marketing_api/auth"
    tiktok_oauth_token_url: str = "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/"
    tiktok_oauth_advertiser_get_url: str = "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/"
    tiktok_oauth_scopes: str = ""
    tiktok_oauth_advertiser_id: str = ""
    tiktok_oauth_public_enabled: bool = False
    tiktok_oauth_state_ttl_seconds: int = 900
    yandex_oauth_client_id: str = ""
    yandex_oauth_client_secret: str = ""
    yandex_oauth_scope: str = "direct:api"
    yandex_oauth_authorize_url: str = "https://oauth.yandex.ru/authorize"
    yandex_oauth_token_url: str = "https://oauth.yandex.ru/token"
    yandex_direct_clients_url: str = "https://api.direct.yandex.com/json/v5/clients"
    yandex_direct_login: str = ""
    yandex_direct_client_login: str = ""
    yandex_oauth_public_enabled: bool = False
    yandex_oauth_state_ttl_seconds: int = 900
    connection_store_path: str = "tokens/connections.json"
    connections_fallback_to_local: bool = True
    clickhouse_enabled: bool = False
    clickhouse_host: str = "127.0.0.1"
    clickhouse_port: int = 8123
    clickhouse_database: str = "ad_mcp_ai"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    clickhouse_secure: bool = False
    clickhouse_timeout_seconds: float = 5.0
    clickhouse_auto_sync_workspace: bool = True
    project_root: Path = Field(default=ROOT_DIR)

    @property
    def audit_log_file(self) -> Path:
        return self.project_root / self.audit_log_path

    @property
    def connections_config_path(self) -> Path:
        return self.project_root / self.connections_config

    @property
    def policy_config_path(self) -> Path:
        return self.project_root / self.policy_config

    @property
    def connection_store_file(self) -> Path:
        return self.project_root / self.connection_store_path

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host.strip() and self.smtp_from_email.strip())

    @property
    def profile_upload_path(self) -> Path:
        path = Path(self.profile_upload_dir)
        if not path.is_absolute():
            path = self.project_root / path
        return path

    @property
    def effective_database_url(self) -> str:
        configured = self.database_url.strip()
        if configured:
            return configured
        return f"sqlite:///{(self.project_root / 'tokens' / 'adforge_auth.db').as_posix()}"

    @property
    def mcp_route_path(self) -> str:
        clean = (self.mcp_endpoint_path or "/mcp").strip()
        if not clean.startswith("/"):
            clean = f"/{clean}"
        return clean

    @property
    def public_base_or_local_mcp_url(self) -> str:
        configured = self.public_base_url.strip()
        if configured:
            return configured.rstrip("/")
        host = self.mcp_http_host
        if host in {"0.0.0.0", "::"}:
            host = "127.0.0.1"
        return f"http://{host}:{self.mcp_http_port}"

    @property
    def public_base_or_local_web_url(self) -> str:
        configured = self.public_base_url.strip()
        if configured:
            return configured.rstrip("/")
        host = self.web_host
        if host in {"0.0.0.0", "::"}:
            host = "127.0.0.1"
        return f"http://{host}:{self.web_port}"

    @property
    def public_mcp_url(self) -> str:
        configured = self.mcp_public_url.strip()
        if configured:
            return configured.rstrip("/")
        return f"{self.public_base_or_local_mcp_url}{self.mcp_route_path}"

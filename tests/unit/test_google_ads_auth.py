from ad_mcp.providers.google_ads.auth import credentials_from_config


def _config() -> dict[str, str]:
    return {
        "account_id": "2222222222",
        "customer_id": "2222222222",
        "developer_token": "developer-token",
        "oauth_client_id": "client-id",
        "oauth_client_secret": "client-secret",
        "refresh_token": "refresh-token",
    }


def test_credentials_use_manager_customer_id_for_legacy_connection() -> None:
    config = _config() | {"manager_customer_id": "111-111-1111", "login_customer_id": ""}

    credentials = credentials_from_config(config)

    assert credentials.login_customer_id == "1111111111"


def test_credentials_prefer_explicit_login_customer_id() -> None:
    config = _config() | {
        "manager_customer_id": "1111111111",
        "login_customer_id": "333-333-3333",
    }

    credentials = credentials_from_config(config)

    assert credentials.login_customer_id == "3333333333"

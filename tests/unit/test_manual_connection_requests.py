from __future__ import annotations

import pytest

from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore, AuthValidationError


def _store(tmp_path):
    settings = Settings(project_root=tmp_path, database_url=f"sqlite:///{tmp_path / 'auth.db'}")
    store = AuthStore(settings)
    store.ensure_schema()
    return store


def test_manual_meta_request_is_workspace_scoped_and_normalizes_account_id(tmp_path) -> None:
    store = _store(tmp_path)
    client = store.create_user(email="client@example.com", name="Client", password="password-123")

    request = store.create_manual_connection_request(
        client,
        {
            "company_name": "Client project",
            "ad_account_id": "1234567890123456",
            "business_id": "9876543210987654",
            "page_id": "111111111111111",
            "instagram_username": "@client_ads",
            "contact_preference": "email",
        },
    )

    assert request["created"] is True
    assert request["meta_ad_account_id"] == "act_1234567890123456"
    assert request["instagram_username"] == "client_ads"
    assert store.list_manual_connection_requests_for_user(client)[0]["id"] == request["id"]
    assert "access_token" not in request
    assert "password" not in request


def test_manual_meta_request_deduplicates_active_requests_and_rejects_secrets(tmp_path) -> None:
    store = _store(tmp_path)
    client = store.create_user(email="client@example.com", name="Client", password="password-123")
    payload = {"ad_account_id": "act_1234567890123456"}

    first = store.create_manual_connection_request(client, payload)
    duplicate = store.create_manual_connection_request(client, payload)

    assert first["created"] is True
    assert duplicate["created"] is False
    assert duplicate["id"] == first["id"]

    with pytest.raises(AuthValidationError, match="токены|секреты"):
        store.create_manual_connection_request(client, {**payload, "access_token": "never-store-this"})


def test_admin_can_update_request_status_without_exposing_credentials(tmp_path) -> None:
    store = _store(tmp_path)
    client = store.create_user(email="client@example.com", name="Client", password="password-123")
    admin = store.create_user(email="admin@example.com", name="Admin", password="password-123", role="admin")
    request = store.create_manual_connection_request(client, {"ad_account_id": "1234567890123456"})

    updated = store.update_manual_connection_request(
        request["id"],
        status="waiting_for_client",
        specialist_note="Добавьте HolyMedia в партнёры Business Manager.",
        assigned_to=admin.id,
        actor_user_id=admin.id,
    )

    assert updated["status"] == "waiting_for_client"
    assert updated["assigned_to"] == admin.id
    assert updated["specialist_note"]
    admin_rows = store.list_manual_connection_requests()
    assert admin_rows[0]["user_email"] == "client@example.com"
    assert all("access_token" not in row for row in admin_rows)
    assert store.manual_connection_request(request["id"])["workspace_id"] == client.workspace_id
    assert store.user_by_id(client.id).workspace_id == client.workspace_id


def test_manual_meta_request_rejects_invalid_ids(tmp_path) -> None:
    store = _store(tmp_path)
    client = store.create_user(email="client@example.com", name="Client", password="password-123")

    with pytest.raises(AuthValidationError, match="ID рекламного кабинета"):
        store.create_manual_connection_request(client, {"ad_account_id": "not-an-id"})

from __future__ import annotations

from datetime import datetime, timezone
from datetime import date
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


ProviderName = Literal["google_ads", "meta_ads", "tiktok_ads", "yandex_direct"]
ActionName = Literal["create", "update", "delete_or_archive"]


class DateRange(BaseModel):
    start_date: str
    end_date: str

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_iso_date(cls, value: str) -> str:
        date.fromisoformat(value)
        return value


class AccountRef(BaseModel):
    provider: ProviderName
    account_id: str
    name: str | None = None
    status: str | None = None


class CapabilityMap(BaseModel):
    provider: ProviderName
    read_objects: list[str] = Field(default_factory=list)
    write_objects: list[str] = Field(default_factory=list)
    supported_metrics: list[str] = Field(default_factory=list)
    supported_dimensions: list[str] = Field(default_factory=list)
    supported_campaign_types: list[str] = Field(default_factory=list)
    supported_audience_types: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ReportRequest(BaseModel):
    provider: ProviderName
    account_id: str
    entity_level: str
    date_range: DateRange
    fields: list[str] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)
    breakdowns: list[str] = Field(default_factory=list)

    @field_validator("entity_level")
    @classmethod
    def normalize_entity_level(cls, value: str) -> str:
        return value.strip().lower()


class ReportResponse(BaseModel):
    provider: ProviderName
    entity_level: str
    date_range: DateRange
    rows: list[dict[str, Any]] = Field(default_factory=list)
    normalized_metrics: list[str] = Field(default_factory=list)
    native_metrics: list[str] = Field(default_factory=list)
    unsupported_requested_fields: list[str] = Field(default_factory=list)
    source_api: str
    preview: bool = False


class PreviewRecord(BaseModel):
    token: str = Field(default_factory=lambda: str(uuid4()))
    action: ActionName
    provider: ProviderName
    account_id: str
    object_type: str
    payload: dict[str, Any]
    provider_payload: dict[str, Any] = Field(default_factory=dict)
    diff: dict[str, Any] = Field(default_factory=dict)
    risk_flags: list[str] = Field(default_factory=list)
    operation: str | None = None
    object_id: str | None = None
    current_snapshot: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_in_seconds: int = 900


class ObjectMutationResponse(BaseModel):
    status: Literal["preview", "committed", "blocked"]
    provider: ProviderName
    account_id: str
    object_type: str
    action: ActionName
    preview_token: str | None = None
    diff: dict[str, Any] = Field(default_factory=dict)
    risk_flags: list[str] = Field(default_factory=list)
    provider_payload: dict[str, Any] = Field(default_factory=dict)
    provider_response: dict[str, Any] = Field(default_factory=dict)

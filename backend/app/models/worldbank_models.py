from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.request_models import DateFilterRequest, MetadataOption


def _normalize_country_code(value: str) -> str:
    normalized = value.strip().upper()
    if not normalized:
        raise ValueError("must not be empty")
    return normalized


def _normalize_indicator_code(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("must not be empty")
    return normalized


class WorldBankDataRequest(DateFilterRequest):
    countries: list[str] = Field(..., min_length=1)
    indicators: list[str] = Field(..., min_length=1)

    @field_validator("countries", mode="before")
    @classmethod
    def validate_countries(cls, value: object) -> object:
        if not isinstance(value, list) or not value:
            raise ValueError("must contain at least one country")
        return value

    @field_validator("indicators", mode="before")
    @classmethod
    def validate_indicators(cls, value: object) -> object:
        if not isinstance(value, list) or not value:
            raise ValueError("must contain at least one indicator")
        return value

    @field_validator("countries")
    @classmethod
    def normalize_countries(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            country_code = _normalize_country_code(value)
            if country_code not in seen:
                seen.add(country_code)
                normalized.append(country_code)
        return normalized

    @field_validator("indicators")
    @classmethod
    def normalize_indicators(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            indicator_code = _normalize_indicator_code(value)
            if indicator_code not in seen:
                seen.add(indicator_code)
                normalized.append(indicator_code)
        return normalized

    model_config = ConfigDict(populate_by_name=True)


class WorldBankRow(BaseModel):
    country: str
    indicator: str
    year: int
    value: float | None = None


class WorldBankMetadataResponse(BaseModel):
    countries: list[MetadataOption]
    indicators: list[MetadataOption]
    last_updated: str = Field(alias="lastUpdated")

    model_config = ConfigDict(populate_by_name=True)


class WorldBankDataResponse(BaseModel):
    rows: list[WorldBankRow]
    total_rows: int = Field(alias="totalRows")
    warnings: list[str] = Field(default_factory=list)
    last_updated: str = Field(alias="lastUpdated")

    model_config = ConfigDict(populate_by_name=True)

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_code(value: str) -> str:
    normalized = value.strip().upper()
    if not normalized:
        raise ValueError("must not be empty")
    return normalized


class DataRequest(BaseModel):
    country: str = Field(..., min_length=1)
    indicator: str = Field(..., min_length=1)

    @field_validator("country", "indicator")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return _normalize_code(value)


class MetadataOption(BaseModel):
    label: str
    value: str


class IndicatorOption(MetadataOption):
    description: str | None = None
    source: str | None = None
    unit: str | None = None
    dataset: str | None = None


class Observation(BaseModel):
    year: int
    value: float


class MetadataResponse(BaseModel):
    countries: list[MetadataOption]
    indicators: list[IndicatorOption]
    last_updated: str = Field(alias="lastUpdated")

    model_config = ConfigDict(populate_by_name=True)


class SeriesResponse(BaseModel):
    country: str
    country_label: str = Field(alias="countryLabel")
    indicator: str
    indicator_label: str = Field(alias="indicatorLabel")
    data: list[Observation]
    used_fallback: bool = Field(alias="usedFallback")
    message: str | None = None
    last_updated: str = Field(alias="lastUpdated")

    model_config = ConfigDict(populate_by_name=True)


class ErrorResponse(BaseModel):
    error: bool = True
    code: str
    message: str
    details: str | None = None

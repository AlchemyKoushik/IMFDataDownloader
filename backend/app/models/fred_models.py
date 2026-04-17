from __future__ import annotations

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from app.models.request_models import DateFilterRequest


def _normalize_series_id(value: str) -> str:
    normalized = value.strip().upper()
    if not normalized:
        raise ValueError("must not be empty")
    return normalized


class FredSearchResult(BaseModel):
    id: str
    title: str
    frequency: str


class FredSeriesRow(BaseModel):
    series_id: str = Field(alias="seriesId")
    title: str
    date: str
    value: float | None = None

    model_config = ConfigDict(populate_by_name=True)


class FredDataRequest(DateFilterRequest):
    series_ids: list[str] = Field(..., min_length=1, validation_alias=AliasChoices("series_ids", "seriesIds"))

    @field_validator("series_ids", mode="before")
    @classmethod
    def validate_series_ids(cls, value: object) -> object:
        if not isinstance(value, list) or not value:
            raise ValueError("must contain at least one series id")
        return value

    @field_validator("series_ids")
    @classmethod
    def normalize_series_ids(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()

        for value in values:
            series_id = _normalize_series_id(value)
            if series_id in seen:
                continue
            seen.add(series_id)
            normalized.append(series_id)

        return normalized

    model_config = ConfigDict(populate_by_name=True)


class FredDataResponse(BaseModel):
    rows: list[FredSeriesRow]
    total_rows: int = Field(alias="totalRows")
    warnings: list[str] = Field(default_factory=list)
    last_updated: str = Field(alias="lastUpdated")

    model_config = ConfigDict(populate_by_name=True)

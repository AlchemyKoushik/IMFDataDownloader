from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


def _normalize_code(value: str) -> str:
    normalized = value.strip().upper()
    if not normalized:
        raise ValueError("must not be empty")
    return normalized


class DateFilterRequest(BaseModel):
    mode: Literal["preset", "custom"] | None = None
    years: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("years", "latestYears"))
    start_year: int | None = Field(default=None, ge=1900, validation_alias=AliasChoices("start_year", "startYear"))
    end_year: int | None = Field(default=None, ge=1900, validation_alias=AliasChoices("end_year", "endYear"))

    @model_validator(mode="after")
    def validate_date_filter(self) -> "DateFilterRequest":
        normalized_mode = self.mode

        if normalized_mode is None:
            if self.start_year is not None or self.end_year is not None:
                normalized_mode = "custom"
            elif self.years is not None:
                normalized_mode = "preset"

        if normalized_mode == "preset":
            if self.start_year is not None or self.end_year is not None:
                raise ValueError("start_year and end_year are only allowed when mode is custom")
            if self.years is None:
                raise ValueError("years is required when mode is preset")
        elif normalized_mode == "custom":
            if self.years is not None:
                raise ValueError("years is only allowed when mode is preset")
            if (self.start_year is None) != (self.end_year is None):
                raise ValueError("start_year and end_year must be provided together")
            if self.start_year is None or self.end_year is None:
                raise ValueError("start_year and end_year are required when mode is custom")
            if self.start_year > self.end_year:
                raise ValueError("start_year must be less than or equal to end_year")
        else:
            if self.years is not None and (self.start_year is not None or self.end_year is not None):
                raise ValueError("Provide either years or start_year/end_year, not both")
            if (self.start_year is None) != (self.end_year is None):
                raise ValueError("start_year and end_year must be provided together")
            if self.start_year is not None and self.end_year is not None and self.start_year > self.end_year:
                raise ValueError("start_year must be less than or equal to end_year")

        self.mode = normalized_mode
        return self

    def uses_preset_range(self) -> bool:
        return self.mode == "preset" and self.years is not None

    def uses_custom_range(self) -> bool:
        return self.mode == "custom" and self.start_year is not None and self.end_year is not None

    model_config = ConfigDict(populate_by_name=True)


class DataRequest(DateFilterRequest):
    country: str = Field(..., min_length=1)
    indicator: str = Field(..., min_length=1)

    @field_validator("country", "indicator")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return _normalize_code(value)


class BulkDataRequest(DateFilterRequest):
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
            country_code = _normalize_code(value)
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
            indicator_code = _normalize_code(value)
            if indicator_code not in seen:
                seen.add(indicator_code)
                normalized.append(indicator_code)
        return normalized

    model_config = ConfigDict(populate_by_name=True)


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
    value: float | None = None


class GridObservation(BaseModel):
    country: str
    indicator: str
    year: int
    value: float | None = None


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


class BulkSeriesResponse(BaseModel):
    rows: list[GridObservation]
    total_rows: int = Field(alias="totalRows")
    warnings: list[str] = Field(default_factory=list)
    last_updated: str = Field(alias="lastUpdated")

    model_config = ConfigDict(populate_by_name=True)


class AvailableYearRangeResponse(BaseModel):
    start_year: int = Field(alias="startYear")
    end_year: int = Field(alias="endYear")
    last_updated: str = Field(alias="lastUpdated")

    model_config = ConfigDict(populate_by_name=True)


class ErrorResponse(BaseModel):
    error: bool = True
    code: str
    message: str
    details: str | None = None

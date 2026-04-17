from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.models.request_models import (
    AvailableYearRangeResponse,
    BulkDataRequest,
    BulkSeriesResponse,
    DataRequest,
    GridObservation,
    IndicatorOption,
    MetadataOption,
    MetadataResponse,
    Observation,
    SeriesResponse,
)
from app.utils.cache import TTLCache
from app.utils.retry import RetryableUpstreamError, run_with_retry


logger = logging.getLogger(__name__)

IMF_BASE_URL = "https://www.imf.org/external/datamapper/api/v1"
METADATA_CACHE_KEY = "metadata"
METADATA_TTL_SECONDS = 24 * 60 * 60
SERIES_TTL_SECONDS = 60 * 60
MAX_CONCURRENT_REQUESTS = 3

AFRICAN_COUNTRY_CODES = {
    "AGO",
    "BDI",
    "BEN",
    "BFA",
    "BWA",
    "CAF",
    "CIV",
    "CMR",
    "COD",
    "COG",
    "COM",
    "CPV",
    "DJI",
    "DZA",
    "EGY",
    "ERI",
    "ETH",
    "GAB",
    "GHA",
    "GIN",
    "GMB",
    "GNB",
    "GNQ",
    "KEN",
    "LBR",
    "LBY",
    "LSO",
    "MAR",
    "MDG",
    "MLI",
    "MOZ",
    "MRT",
    "MUS",
    "MWI",
    "NAM",
    "NER",
    "NGA",
    "RWA",
    "SDN",
    "SEN",
    "SLE",
    "SOM",
    "SSD",
    "STP",
    "SWZ",
    "SYC",
    "TCD",
    "TGO",
    "TUN",
    "TZA",
    "UGA",
    "ZAF",
    "ZMB",
    "ZWE",
}

WEO_FALLBACK_CODE_MAP = {
    "BCA_GDP": "BCA_NGDPD",
    "GGX_GDP": "GGX_NGDP",
    "GGXCNL_GDP": "GGXCNL_NGDP",
    "GGRXG_GDP": "GGR_NGDP",
    "GGXWDG_GDP": "GGXWDG_NGDP",
    "NGDP_R_PCH": "NGDP_RPCH",
    "NGS_GDP": "NGSD_NGDP",
    "NI_GDP": "NID_NGDP",
    "PCPI_PCH": "PCPIPCH",
    "PCPIE_PCH": "PCPIEPCH",
}

WEO_FALLBACK_LABEL_RULES: list[tuple[str, str]] = [
    ("NGDP_RPCH", r"real gdp growth"),
    ("PCPIPCH", r"(consumer prices.*average|inflation rate.*average consumer prices)"),
    ("PCPIEPCH", r"(consumer prices.*end of period|inflation rate.*end of period consumer prices)"),
    ("GGXCNL_NGDP", r"(overall fiscal balance|net lending|borrowing)"),
    ("GGXWDG_NGDP", r"(government debt|gross debt)"),
    ("BCA_NGDPD", r"(external current account|current account balance)"),
    ("NID_NGDP", r"total investment"),
    ("NGSD_NGDP", r"gross national savings"),
]

STOP_WORDS = {
    "a",
    "an",
    "and",
    "annual",
    "average",
    "change",
    "consumer",
    "end",
    "including",
    "inflation",
    "of",
    "period",
    "percent",
    "prices",
    "rate",
    "the",
}


class IMFServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500, code: str = "IMF_SERVICE_ERROR", details: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


@dataclass(slots=True)
class SeriesPayload:
    country: str
    indicator: str
    data: list[Observation]
    last_updated: str


@dataclass(slots=True)
class ResolvedSeriesResult:
    country: MetadataOption
    requested_indicator: IndicatorOption
    resolved_indicator: IndicatorOption
    payload: SeriesPayload
    used_fallback: bool
    message: str | None


@dataclass(slots=True)
class BulkSelectionResult:
    rows: list[GridObservation]
    warnings: list[str]


def normalize_code(value: str | None) -> str:
    return str(value or "").strip().upper()


def sanitize_text(value: str) -> str:
    return " ".join(str(value).replace("\r", " ").replace("\n", " ").split()).strip()


def option_sort_key(option: MetadataOption) -> tuple[str, str]:
    return (option.label.casefold(), option.value.casefold())


def get_dataset_code(dataset: str | None) -> str:
    return normalize_code(dataset)


def is_african_country(country_code: str) -> bool:
    return normalize_code(country_code) in AFRICAN_COUNTRY_CODES


def is_dataset_valid_for_country(country_code: str, dataset: str | None) -> bool:
    normalized_country = normalize_code(country_code)
    normalized_dataset = get_dataset_code(dataset)

    if not normalized_country or not normalized_dataset:
        return True

    if normalized_dataset == "AFRREO":
        return is_african_country(normalized_country)

    return True


def get_dataset_country_message(dataset: str | None) -> str:
    if get_dataset_code(dataset) == "AFRREO":
        return "AFR Regional Economic Outlook indicators are available only for African countries."

    return "The selected dataset is not available for this country."


def get_weo_indicators(indicators: list[IndicatorOption]) -> list[IndicatorOption]:
    return [indicator for indicator in indicators if get_dataset_code(indicator.dataset) == "WEO"]


def get_meaningful_tokens(value: str) -> list[str]:
    tokens = []
    for raw_token in normalize_code(value).replace("/", " ").replace("-", " ").split():
        token = "".join(character for character in raw_token if character.isalnum())
        if len(token) > 2 and token.lower() not in STOP_WORDS:
            tokens.append(token)
    return tokens


def score_label_similarity(source_label: str, candidate_label: str) -> int:
    source_tokens = set(get_meaningful_tokens(source_label))
    candidate_tokens = set(get_meaningful_tokens(candidate_label))
    return sum(1 for token in source_tokens if token in candidate_tokens)


def resolve_weo_fallback_indicator(indicator: IndicatorOption, indicators: list[IndicatorOption]) -> IndicatorOption | None:
    weo_indicators = get_weo_indicators(indicators)
    if not weo_indicators:
        return None

    if get_dataset_code(indicator.dataset) == "WEO":
        return indicator

    normalized_code = normalize_code(indicator.value)
    mapped_code = WEO_FALLBACK_CODE_MAP.get(normalized_code)

    if mapped_code:
        for option in weo_indicators:
            if normalize_code(option.value) == mapped_code:
                return option

    for option in weo_indicators:
        if normalize_code(option.value) == normalized_code:
            return option

    for code, pattern in WEO_FALLBACK_LABEL_RULES:
        if re.search(pattern, indicator.label, flags=re.IGNORECASE):
            for option in weo_indicators:
                if normalize_code(option.value) == code:
                    return option

    ranked_matches = sorted(
        ((option, score_label_similarity(indicator.label, option.label)) for option in weo_indicators),
        key=lambda item: item[1],
        reverse=True,
    )
    if ranked_matches and ranked_matches[0][1] >= 2:
        return ranked_matches[0][0]

    return None


def select_latest_year_rows(rows: list[GridObservation], latest_years: int) -> tuple[list[GridObservation], str | None]:
    if not rows:
        return [], None

    current_year = time.gmtime().tm_year
    target_start_year = current_year - latest_years + 1
    requested_window_rows = [row for row in rows if target_start_year <= row.year <= current_year]

    if len(requested_window_rows) >= latest_years:
        return requested_window_rows[-latest_years:], None

    fallback_rows = rows[-min(latest_years, len(rows)) :]
    start_year = fallback_rows[0].year
    end_year = fallback_rows[-1].year

    if len(fallback_rows) < latest_years:
        warning = (
            f"{rows[0].country} / {rows[0].indicator}: data is not available for the latest {latest_years} years. "
            f"Exporting {len(fallback_rows)} available years instead ({start_year}-{end_year})."
        )
    else:
        warning = (
            f"{rows[0].country} / {rows[0].indicator}: data is not available for the latest {latest_years} years. "
            f"Exporting the last {latest_years} available years instead ({start_year}-{end_year})."
        )

    return fallback_rows, warning


def select_latest_observations(observations: list[Observation], latest_years: int) -> list[Observation]:
    if not observations:
        return []

    current_year = time.gmtime().tm_year
    target_start_year = current_year - latest_years + 1
    requested_window_rows = [row for row in observations if target_start_year <= row.year <= current_year and row.value is not None]

    if len(requested_window_rows) >= latest_years:
        return requested_window_rows[-latest_years:]

    return observations[-min(latest_years, len(observations)) :]


def select_custom_observations(observations: list[Observation], start_year: int, end_year: int) -> list[Observation]:
    value_by_year = {observation.year: observation.value for observation in observations}
    return [Observation(year=year, value=value_by_year.get(year)) for year in range(start_year, end_year + 1)]


def select_custom_year_rows(
    rows: list[GridObservation],
    start_year: int,
    end_year: int,
) -> tuple[list[GridObservation], str | None]:
    if not rows:
        return [], None

    first_row = rows[0]
    value_by_year = {row.year: row.value for row in rows}
    selected_rows = [
        GridObservation(
            country=first_row.country,
            indicator=first_row.indicator,
            year=year,
            value=value_by_year.get(year),
        )
        for year in range(start_year, end_year + 1)
    ]

    if not any(row.value is not None for row in selected_rows):
        warning = f"{first_row.country} / {first_row.indicator}: no data was returned for the selected range."
    elif any(row.value is None for row in selected_rows):
        warning = f"{first_row.country} / {first_row.indicator}: some years in the selected range did not return values and were left blank."
    else:
        warning = None

    return selected_rows, warning


class IMFService:
    def __init__(self, client: httpx.AsyncClient):
        self._client = client
        self._metadata_cache = TTLCache[MetadataResponse](METADATA_TTL_SECONDS)
        self._series_cache = TTLCache[SeriesPayload](SERIES_TTL_SECONDS)
        self._metadata_lock = asyncio.Lock()
        self._series_locks: dict[str, asyncio.Lock] = {}
        self._series_locks_guard = asyncio.Lock()
        self._request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async def get_metadata(self) -> MetadataResponse:
        cached = self._metadata_cache.get(METADATA_CACHE_KEY)
        if cached is not None:
            logger.info("metadata cache hit")
            return cached

        async with self._metadata_lock:
            cached = self._metadata_cache.get(METADATA_CACHE_KEY)
            if cached is not None:
                logger.info("metadata cache hit after lock")
                return cached

            logger.info("metadata cache miss")
            countries_response, indicators_response = await asyncio.gather(
                self._request_json("/countries", "countries metadata"),
                self._request_json("/indicators", "indicators metadata"),
            )

            metadata = MetadataResponse(
                countries=self._normalize_countries(countries_response),
                indicators=self._normalize_indicators(indicators_response),
                lastUpdated=self._utc_now(),
            )
            self._metadata_cache.set(METADATA_CACHE_KEY, metadata)
            return metadata

    async def get_series(self, request: DataRequest) -> SeriesResponse:
        metadata = await self.get_metadata()
        result = await self._resolve_series(metadata, request.country, request.indicator)
        observations = result.payload.data

        if request.uses_preset_range():
            observations = select_latest_observations(observations, request.years or 1)
        elif request.uses_custom_range():
            observations = select_custom_observations(observations, request.start_year or 1900, request.end_year or 1900)

        return SeriesResponse(
            country=request.country,
            countryLabel=result.country.label,
            indicator=result.resolved_indicator.value,
            indicatorLabel=result.resolved_indicator.label,
            data=observations,
            usedFallback=result.used_fallback,
            message=result.message,
            lastUpdated=result.payload.last_updated,
        )

    async def get_bulk_series(self, request: BulkDataRequest) -> BulkSeriesResponse:
        metadata = await self.get_metadata()
        self._validate_bulk_selection(metadata, request)

        tasks = [
            self._get_bulk_selection_result(metadata, country_code, indicator_code)
            for country_code in request.countries
            for indicator_code in request.indicators
        ]
        selection_results = await asyncio.gather(*tasks)

        rows: list[GridObservation] = []
        warnings: list[str] = []
        for selection_result in selection_results:
            next_rows = selection_result.rows
            if request.uses_preset_range() and selection_result.rows:
                next_rows, latest_year_warning = select_latest_year_rows(selection_result.rows, request.years or 1)
                if latest_year_warning:
                    warnings.append(latest_year_warning)
            elif request.uses_custom_range() and selection_result.rows:
                next_rows, custom_range_warning = select_custom_year_rows(
                    selection_result.rows,
                    request.start_year or 1900,
                    request.end_year or 1900,
                )
                if custom_range_warning:
                    warnings.append(custom_range_warning)

            rows.extend(next_rows)
            warnings.extend(selection_result.warnings)

        rows.sort(key=lambda row: (row.country.casefold(), row.indicator.casefold(), row.year))

        if not rows:
            warning_text = warnings[0] if warnings else "No IMF data is available for the selected countries and indicators."
            raise IMFServiceError(warning_text, 404, "NO_DATA")

        return BulkSeriesResponse(
            rows=rows,
            totalRows=len(rows),
            warnings=warnings,
            lastUpdated=self._utc_now(),
        )

    async def get_bulk_year_range(self, request: BulkDataRequest) -> AvailableYearRangeResponse:
        metadata = await self.get_metadata()
        self._validate_bulk_selection(metadata, request)

        tasks = [
            self._get_bulk_selection_result(metadata, country_code, indicator_code)
            for country_code in request.countries
            for indicator_code in request.indicators
        ]
        selection_results = await asyncio.gather(*tasks)

        available_years = sorted(
            {
                row.year
                for selection_result in selection_results
                for row in selection_result.rows
                if row.value is not None
            }
        )

        if not available_years:
            raise IMFServiceError(
                "No IMF data is available for the selected countries and indicators.",
                404,
                "NO_DATA",
            )

        return AvailableYearRangeResponse(
            startYear=available_years[0],
            endYear=available_years[-1],
            lastUpdated=self._utc_now(),
        )

    async def _resolve_series(self, metadata: MetadataResponse, country_code: str, indicator_code: str) -> ResolvedSeriesResult:
        countries_by_code = {country.value: country for country in metadata.countries}
        indicators_by_code = {indicator.value: indicator for indicator in metadata.indicators}

        country = countries_by_code.get(country_code)
        if country is None:
            raise IMFServiceError("The selected country is not available in the IMF catalog.", 400, "COUNTRY_NOT_FOUND")

        selected_indicator = indicators_by_code.get(indicator_code)
        if selected_indicator is None:
            raise IMFServiceError("The selected indicator is not available in the IMF catalog.", 400, "INDICATOR_NOT_FOUND")

        fallback_indicator = resolve_weo_fallback_indicator(selected_indicator, metadata.indicators)

        if not is_dataset_valid_for_country(country_code, selected_indicator.dataset):
            if fallback_indicator is None:
                raise IMFServiceError(
                    get_dataset_country_message(selected_indicator.dataset),
                    400,
                    "INVALID_DATASET_COUNTRY",
                )

            try:
                payload = await self._get_series_payload(country_code, fallback_indicator.value)
            except IMFServiceError as exc:
                if exc.code == "NO_DATA":
                    raise IMFServiceError(
                        "No data available for the selected indicator, and the WEO fallback also returned no data.",
                        404,
                        "NO_DATA_AFTER_FALLBACK",
                    ) from exc
                raise

            return ResolvedSeriesResult(
                country=country,
                requested_indicator=selected_indicator,
                resolved_indicator=fallback_indicator,
                payload=payload,
                used_fallback=True,
                message="No data was available for the requested dataset, so the WEO fallback was used.",
            )

        try:
            payload = await self._get_series_payload(country_code, selected_indicator.value)
            return ResolvedSeriesResult(
                country=country,
                requested_indicator=selected_indicator,
                resolved_indicator=selected_indicator,
                payload=payload,
                used_fallback=False,
                message=None,
            )
        except IMFServiceError as exc:
            can_fallback = (
                exc.code == "NO_DATA"
                and fallback_indicator is not None
                and normalize_code(fallback_indicator.value) != normalize_code(selected_indicator.value)
            )
            if not can_fallback:
                raise

            try:
                payload = await self._get_series_payload(country_code, fallback_indicator.value)
            except IMFServiceError as fallback_exc:
                if fallback_exc.code == "NO_DATA":
                    raise IMFServiceError(
                        "No data available for the selected indicator, and the WEO fallback also returned no data.",
                        404,
                        "NO_DATA_AFTER_FALLBACK",
                    ) from fallback_exc
                raise

            return ResolvedSeriesResult(
                country=country,
                requested_indicator=selected_indicator,
                resolved_indicator=fallback_indicator,
                payload=payload,
                used_fallback=True,
                message="No data was available for the requested dataset, so the WEO fallback was used.",
            )

    async def _get_bulk_selection_result(
        self,
        metadata: MetadataResponse,
        country_code: str,
        indicator_code: str,
    ) -> BulkSelectionResult:
        try:
            result = await self._resolve_series(metadata, country_code, indicator_code)
        except IMFServiceError as exc:
            if exc.code in {"INVALID_DATASET_COUNTRY", "NO_DATA", "NO_DATA_AFTER_FALLBACK"}:
                country_label = next((country.label for country in metadata.countries if country.value == country_code), country_code)
                indicator_label = next((indicator.label for indicator in metadata.indicators if indicator.value == indicator_code), indicator_code)
                return BulkSelectionResult(
                    rows=[],
                    warnings=[f"{country_label} / {indicator_label}: {exc.message}"],
                )
            raise

        warnings: list[str] = []
        if result.used_fallback:
            warnings.append(
                f"{result.country.label} / {result.requested_indicator.label}: exported using the IMF WEO fallback ({result.resolved_indicator.label})."
            )

        rows = [
            GridObservation(
                country=result.country.label,
                indicator=result.resolved_indicator.label,
                year=observation.year,
                value=observation.value,
            )
            for observation in result.payload.data
        ]

        return BulkSelectionResult(rows=rows, warnings=warnings)

    def _validate_bulk_selection(self, metadata: MetadataResponse, request: BulkDataRequest) -> None:
        countries_by_code = {country.value: country for country in metadata.countries}
        indicators_by_code = {indicator.value: indicator for indicator in metadata.indicators}

        missing_countries = [country_code for country_code in request.countries if country_code not in countries_by_code]
        if missing_countries:
            raise IMFServiceError(
                "One or more selected countries are not available in the IMF catalog.",
                400,
                "COUNTRY_NOT_FOUND",
                details=", ".join(missing_countries),
            )

        missing_indicators = [indicator_code for indicator_code in request.indicators if indicator_code not in indicators_by_code]
        if missing_indicators:
            raise IMFServiceError(
                "One or more selected indicators are not available in the IMF catalog.",
                400,
                "INDICATOR_NOT_FOUND",
                details=", ".join(missing_indicators),
            )

    async def _get_series_payload(self, country: str, indicator: str) -> SeriesPayload:
        cache_key = f"{normalize_code(country)}:{normalize_code(indicator)}"
        cached = self._series_cache.get(cache_key)
        if cached is not None:
            logger.info("series cache hit key=%s", cache_key)
            return cached

        lock = await self._get_series_lock(cache_key)
        async with lock:
            cached = self._series_cache.get(cache_key)
            if cached is not None:
                logger.info("series cache hit after lock key=%s", cache_key)
                return cached

            logger.info("series cache miss key=%s", cache_key)
            response = await self._request_json(f"/{normalize_code(indicator)}/{normalize_code(country)}", f"series {cache_key}")
            payload = self._normalize_series_data(response, normalize_code(country), normalize_code(indicator))
            self._series_cache.set(cache_key, payload)
            return payload

    async def _get_series_lock(self, cache_key: str) -> asyncio.Lock:
        async with self._series_locks_guard:
            existing_lock = self._series_locks.get(cache_key)
            if existing_lock is not None:
                return existing_lock

            lock = asyncio.Lock()
            self._series_locks[cache_key] = lock
            return lock

    async def _request_json(self, path: str, request_label: str) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            url = f"{IMF_BASE_URL}{path if path.startswith('/') else f'/{path}'}"
            started_at = time.perf_counter()
            logger.info("imf request started label=%s url=%s", request_label, url)

            async with self._request_semaphore:
                response = await self._client.get(url)

            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.info(
                "imf response received label=%s status=%s elapsed_ms=%.2f",
                request_label,
                response.status_code,
                elapsed_ms,
            )

            if response.status_code >= 500:
                raise RetryableUpstreamError(f"IMF API returned status {response.status_code} for {request_label}.")

            if response.status_code == 404:
                raise IMFServiceError("No data available for this dataset.", 404, "NO_DATA")

            if response.status_code >= 400:
                raise IMFServiceError(
                    "The IMF API rejected the request.",
                    response.status_code,
                    "IMF_UPSTREAM_CLIENT_ERROR",
                    details=f"Path {path} returned {response.status_code}.",
                )

            content = response.text.strip()
            if not content:
                raise IMFServiceError("The IMF API returned an empty response.", 502, "IMF_EMPTY_RESPONSE")

            try:
                payload = response.json()
            except ValueError as exc:
                raise IMFServiceError("The IMF API returned invalid JSON.", 502, "IMF_INVALID_JSON", str(exc)) from exc

            if not isinstance(payload, dict):
                raise IMFServiceError("The IMF API returned an unexpected payload.", 502, "IMF_INVALID_PAYLOAD")

            return payload

        try:
            return await run_with_retry(request_label, operation)
        except IMFServiceError:
            raise
        except httpx.TimeoutException as exc:
            raise IMFServiceError("The IMF API timed out while processing the request.", 504, "IMF_TIMEOUT") from exc
        except httpx.NetworkError as exc:
            raise IMFServiceError("Unable to reach the IMF API right now.", 503, "IMF_NETWORK_ERROR") from exc
        except RetryableUpstreamError as exc:
            raise IMFServiceError("The IMF API is temporarily unavailable.", 502, "IMF_UPSTREAM_UNAVAILABLE") from exc

    def _normalize_countries(self, response: dict[str, Any]) -> list[MetadataOption]:
        countries = response.get("countries")
        if not isinstance(countries, dict):
            raise IMFServiceError("Unable to load IMF country metadata.", 502, "INVALID_COUNTRY_METADATA")

        normalized = []
        for raw_code, raw_entry in countries.items():
            if not str(raw_code).strip() or not isinstance(raw_entry, dict):
                continue

            raw_label = raw_entry.get("label")
            if not isinstance(raw_label, str) or not raw_label.strip():
                continue

            normalized.append(MetadataOption(label=sanitize_text(raw_label), value=normalize_code(raw_code)))

        return sorted(normalized, key=option_sort_key)

    def _normalize_indicators(self, response: dict[str, Any]) -> list[IndicatorOption]:
        indicators = response.get("indicators")
        if not isinstance(indicators, dict):
            raise IMFServiceError("Unable to load IMF indicator metadata.", 502, "INVALID_INDICATOR_METADATA")

        normalized: list[IndicatorOption] = []
        for raw_code, raw_entry in indicators.items():
            if not str(raw_code).strip() or not isinstance(raw_entry, dict):
                continue

            raw_label = raw_entry.get("label")
            if not isinstance(raw_label, str) or not raw_label.strip():
                continue

            normalized.append(
                IndicatorOption(
                    label=sanitize_text(raw_label),
                    value=normalize_code(raw_code),
                    description=sanitize_text(raw_entry["description"]) if isinstance(raw_entry.get("description"), str) else None,
                    source=sanitize_text(raw_entry["source"]) if isinstance(raw_entry.get("source"), str) else None,
                    unit=sanitize_text(raw_entry["unit"]) if isinstance(raw_entry.get("unit"), str) else None,
                    dataset=sanitize_text(raw_entry["dataset"]) if isinstance(raw_entry.get("dataset"), str) else None,
                )
            )

        return sorted(normalized, key=option_sort_key)

    def _normalize_series_data(self, response: dict[str, Any], country: str, indicator: str) -> SeriesPayload:
        values = response.get("values")
        if not isinstance(values, dict):
            raise IMFServiceError("No data available for this dataset.", 404, "NO_DATA")

        indicator_values = values.get(indicator)
        if not isinstance(indicator_values, dict):
            raise IMFServiceError("No data available for this dataset.", 404, "NO_DATA")

        country_values = indicator_values.get(country)
        if not isinstance(country_values, dict):
            raise IMFServiceError("No data available for this dataset.", 404, "NO_DATA")

        rows: list[Observation] = []
        for raw_year, raw_value in country_values.items():
            if raw_value in (None, ""):
                continue

            try:
                year = int(raw_year)
                value = float(raw_value)
            except (TypeError, ValueError):
                continue

            rows.append(Observation(year=year, value=value))

        rows.sort(key=lambda row: row.year)

        if not rows:
            raise IMFServiceError("No data available for this dataset.", 404, "NO_DATA")

        return SeriesPayload(
            country=country,
            indicator=indicator,
            data=rows,
            last_updated=self._utc_now(),
        )

    def _utc_now(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

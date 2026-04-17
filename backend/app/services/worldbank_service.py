from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import Any

import httpx

from app.models.request_models import AvailableYearRangeResponse, MetadataOption
from app.models.worldbank_models import WorldBankDataRequest, WorldBankDataResponse, WorldBankMetadataResponse, WorldBankRow
from app.utils.cache import TTLCache


logger = logging.getLogger(__name__)

WORLD_BANK_BASE_URL = "https://api.worldbank.org/v2"
COUNTRIES_CACHE_KEY = "worldbank-metadata"
METADATA_TTL_SECONDS = 24 * 60 * 60
COUNTRIES_PER_PAGE = 1000
INDICATORS_PER_PAGE = 20000
DATA_PER_PAGE = 1000
MAX_CONCURRENT_REQUESTS = 2
COUNTRY_BATCH_SIZE = 20
MAX_PAGES = 5
RETRY_DELAYS_SECONDS = (1.0, 2.0, 4.0)
BATCH_DELAY_SECONDS = 0.2


class WorldBankServiceError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 500,
        code: str = "WORLD_BANK_SERVICE_ERROR",
        details: str | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


def sanitize_text(value: object) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()


def option_sort_key(option: MetadataOption) -> tuple[str, str]:
    return (option.label.casefold(), option.value.casefold())


def parse_positive_int(value: object, default: int = 1) -> int:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return default
    return max(parsed, default)


def chunk_values(values: list[str], chunk_size: int) -> list[list[str]]:
    return [values[index : index + chunk_size] for index in range(0, len(values), chunk_size)]


class WorldBankService:
    def __init__(self, client: httpx.AsyncClient):
        self._client = client
        self._metadata_cache = TTLCache[WorldBankMetadataResponse](METADATA_TTL_SECONDS)
        self._metadata_lock = asyncio.Lock()
        self._request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async def get_metadata(self) -> WorldBankMetadataResponse:
        cached = self._metadata_cache.get(COUNTRIES_CACHE_KEY)
        if cached is not None:
            logger.info("world bank metadata cache hit")
            return cached

        async with self._metadata_lock:
            cached = self._metadata_cache.get(COUNTRIES_CACHE_KEY)
            if cached is not None:
                logger.info("world bank metadata cache hit after lock")
                return cached

            logger.info("world bank metadata cache miss")
            countries_records = await self._fetch_paginated_items(
                "/country",
                {"format": "json", "per_page": COUNTRIES_PER_PAGE},
                "world bank countries metadata",
            )
            indicators_records = await self._fetch_paginated_items(
                "/indicator",
                {"format": "json", "per_page": INDICATORS_PER_PAGE},
                "world bank indicators metadata",
            )

            payload = WorldBankMetadataResponse(
                countries=self._normalize_countries(countries_records),
                indicators=self._normalize_indicators(indicators_records),
                lastUpdated=self._utc_now(),
            )
            self._metadata_cache.set(COUNTRIES_CACHE_KEY, payload)
            return payload

    async def get_data(self, request: WorldBankDataRequest) -> WorldBankDataResponse:
        metadata = await self.get_metadata()
        countries_by_code, indicators_by_code = self._validate_selection(metadata, request)

        if request.uses_preset_range():
            rows, warnings = await self._get_latest_years_rows(
                request=request,
                countries_by_code=countries_by_code,
                indicators_by_code=indicators_by_code,
            )
        elif request.uses_custom_range():
            raw_rows = await self._fetch_selection_rows(
                countries=request.countries,
                indicators=request.indicators,
                countries_by_code=countries_by_code,
                indicators_by_code=indicators_by_code,
                date_param=f"{request.start_year}:{request.end_year}",
            )
            expected_pairs = [
                (countries_by_code[country_code].label, indicators_by_code[indicator_code].label)
                for country_code in request.countries
                for indicator_code in request.indicators
            ]
            rows = self._expand_rows_for_custom_range(raw_rows, expected_pairs, request.start_year or 1900, request.end_year or 1900)
            warnings = self._build_custom_range_warnings(rows, expected_pairs)
        else:
            raw_rows = await self._fetch_selection_rows(
                countries=request.countries,
                indicators=request.indicators,
                countries_by_code=countries_by_code,
                indicators_by_code=indicators_by_code,
                date_param=None,
            )
            expected_pairs = [
                (countries_by_code[country_code].label, indicators_by_code[indicator_code].label)
                for country_code in request.countries
                for indicator_code in request.indicators
            ]
            rows = sorted(raw_rows, key=lambda row: (row.country.casefold(), row.indicator.casefold(), row.year))
            warnings = self._build_missing_pair_warnings(rows, expected_pairs)

        has_any_values = any(row.value is not None for row in rows)
        includes_future_years = bool(request.uses_custom_range() and (request.end_year or 0) > time.gmtime().tm_year)

        if not rows or (not has_any_values and not includes_future_years):
            raise WorldBankServiceError(
                "No World Bank data is available for the selected countries, indicators, and range filter.",
                404,
                "NO_DATA",
            )

        return WorldBankDataResponse(
            rows=rows,
            totalRows=len(rows),
            warnings=warnings,
            lastUpdated=self._utc_now(),
        )

    async def get_selection_year_range(self, request: WorldBankDataRequest) -> AvailableYearRangeResponse:
        metadata = await self.get_metadata()
        countries_by_code, indicators_by_code = self._validate_selection(metadata, request)
        rows = await self._fetch_selection_rows(
            countries=request.countries,
            indicators=request.indicators,
            countries_by_code=countries_by_code,
            indicators_by_code=indicators_by_code,
            date_param=None,
        )

        available_years = sorted({row.year for row in rows if row.value is not None})
        if not available_years:
            raise WorldBankServiceError(
                "No World Bank data is available for the selected countries and indicators.",
                404,
                "NO_DATA",
            )

        return AvailableYearRangeResponse(
            startYear=available_years[0],
            endYear=available_years[-1],
            lastUpdated=self._utc_now(),
        )

    async def _fetch_selection_rows(
        self,
        *,
        countries: list[str],
        indicators: list[str],
        countries_by_code: dict[str, MetadataOption],
        indicators_by_code: dict[str, MetadataOption],
        date_param: str | None,
    ) -> list[WorldBankRow]:
        rows: list[WorldBankRow] = []
        country_batches = chunk_values(countries, COUNTRY_BATCH_SIZE)

        for indicator_index, indicator_code in enumerate(indicators):
            indicator_label = indicators_by_code[indicator_code].label

            for batch_index, country_batch in enumerate(country_batches):
                batch_rows = await self._fetch_indicator_rows(
                    country_batch=country_batch,
                    indicator_code=indicator_code,
                    indicator_label=indicator_label,
                    country_lookup=countries_by_code,
                    date_param=date_param,
                )
                rows.extend(batch_rows)

                if self._should_pause_between_batches(indicator_index, batch_index, len(indicators), len(country_batches)):
                    await asyncio.sleep(BATCH_DELAY_SECONDS)

        return self._dedupe_rows(rows)

    async def _fetch_indicator_rows(
        self,
        *,
        country_batch: list[str],
        indicator_code: str,
        indicator_label: str,
        country_lookup: dict[str, MetadataOption],
        date_param: str | None,
    ) -> list[WorldBankRow]:
        params: dict[str, str | int] = {
            "format": "json",
            "per_page": DATA_PER_PAGE,
        }
        if date_param:
            params["date"] = date_param

        path = f"/country/{';'.join(country_batch)}/indicator/{indicator_code}"
        records = await self._fetch_paginated_items(
            path,
            params,
            f"world bank series indicator={indicator_code} countries={';'.join(country_batch)}",
        )
        return self._normalize_rows(records, indicator_label=indicator_label, country_lookup=country_lookup)

    async def _fetch_paginated_items(
        self,
        path: str,
        params: dict[str, str | int],
        request_label: str,
    ) -> list[dict[str, Any]]:
        first_payload = await self._request_json(path, params, request_label)
        first_metadata, first_items = self._parse_paginated_payload(first_payload)
        total_pages = parse_positive_int(first_metadata.get("pages"), 1)
        capped_total_pages = min(total_pages, MAX_PAGES)

        if total_pages > MAX_PAGES:
            logger.warning(
                "world bank page count capped label=%s requested_pages=%s max_pages=%s",
                request_label,
                total_pages,
                MAX_PAGES,
            )

        records = list(first_items)
        if capped_total_pages == 1:
            return records

        for page_number in range(2, capped_total_pages + 1):
            payload = await self._request_json(
                path,
                {**params, "page": page_number},
                f"{request_label} page={page_number}",
            )
            _, page_items = self._parse_paginated_payload(payload)
            records.extend(page_items)

            if page_number < capped_total_pages:
                await asyncio.sleep(BATCH_DELAY_SECONDS)

        return records

    async def _request_json(
        self,
        path: str,
        params: dict[str, str | int],
        request_label: str,
    ) -> Any:
        url = f"{WORLD_BANK_BASE_URL}{path}"
        max_attempts = len(RETRY_DELAYS_SECONDS) + 1

        for attempt in range(1, max_attempts + 1):
            started_at = time.perf_counter()
            logger.info(
                "world bank request started label=%s url=%s params=%s attempt=%s/%s",
                request_label,
                url,
                params,
                attempt,
                max_attempts,
            )

            try:
                async with self._request_semaphore:
                    response = await self._client.get(url, params=params)
            except httpx.TimeoutException as exc:
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                logger.warning(
                    "world bank timeout label=%s url=%s params=%s attempt=%s/%s elapsed_ms=%.2f",
                    request_label,
                    url,
                    params,
                    attempt,
                    max_attempts,
                    elapsed_ms,
                )
                if await self._sleep_before_retry(request_label, url, params, attempt, "timeout"):
                    continue
                raise WorldBankServiceError("The World Bank API timed out while processing the request.", 504, "WORLD_BANK_TIMEOUT") from exc
            except httpx.NetworkError as exc:
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                logger.warning(
                    "world bank network error label=%s url=%s params=%s attempt=%s/%s elapsed_ms=%.2f error=%s",
                    request_label,
                    url,
                    params,
                    attempt,
                    max_attempts,
                    elapsed_ms,
                    exc,
                )
                if await self._sleep_before_retry(request_label, url, params, attempt, "network error"):
                    continue
                raise WorldBankServiceError("Unable to reach the World Bank API right now.", 503, "WORLD_BANK_NETWORK_ERROR") from exc

            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.info(
                "world bank response received label=%s status=%s elapsed_ms=%.2f attempt=%s/%s",
                request_label,
                response.status_code,
                elapsed_ms,
                attempt,
                max_attempts,
            )

            if response.status_code == 429:
                if await self._sleep_before_retry(request_label, url, params, attempt, "status 429"):
                    continue
                raise WorldBankServiceError(
                    "The World Bank API is rate limiting requests right now. Please try again shortly.",
                    503,
                    "WORLD_BANK_RATE_LIMITED",
                    details=f"Path {path} returned 429 after retries.",
                )

            if response.status_code >= 500:
                if await self._sleep_before_retry(request_label, url, params, attempt, f"status {response.status_code}"):
                    continue
                raise WorldBankServiceError(
                    "The World Bank API is temporarily unavailable.",
                    502,
                    "WORLD_BANK_UPSTREAM_UNAVAILABLE",
                    details=f"Path {path} returned {response.status_code} after retries.",
                )

            if response.status_code == 404:
                raise WorldBankServiceError("No data available for this World Bank request.", 404, "NO_DATA")

            if response.status_code >= 400:
                raise WorldBankServiceError(
                    "The World Bank API rejected the request.",
                    response.status_code,
                    "WORLD_BANK_UPSTREAM_CLIENT_ERROR",
                    details=self._build_client_error_details(response, path),
                )

            try:
                return response.json()
            except ValueError as exc:
                raise WorldBankServiceError(
                    "The World Bank API returned invalid JSON.",
                    502,
                    "WORLD_BANK_INVALID_JSON",
                    str(exc),
                ) from exc

        raise RuntimeError("World Bank retry loop exited unexpectedly.")

    async def _sleep_before_retry(
        self,
        request_label: str,
        url: str,
        params: dict[str, str | int],
        attempt: int,
        reason: str,
    ) -> bool:
        if attempt > len(RETRY_DELAYS_SECONDS):
            return False

        delay_seconds = RETRY_DELAYS_SECONDS[attempt - 1]
        logger.warning(
            "WorldBank retry %s for %s params=%s reason=%s delay=%.1fs label=%s",
            attempt,
            url,
            params,
            reason,
            delay_seconds,
            request_label,
        )
        await asyncio.sleep(delay_seconds)
        return True

    def _build_client_error_details(self, response: httpx.Response, path: str) -> str:
        response_text = sanitize_text(response.text)
        if response_text:
            return f"Path {path} returned {response.status_code}: {response_text[:200]}"
        return f"Path {path} returned {response.status_code}."

    def _parse_paginated_payload(self, payload: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        if not isinstance(payload, list) or len(payload) < 2:
            raise WorldBankServiceError(
                "The World Bank API returned an unexpected payload.",
                502,
                "WORLD_BANK_INVALID_PAYLOAD",
            )

        metadata, records = payload[0], payload[1]
        if not isinstance(metadata, dict):
            raise WorldBankServiceError(
                "The World Bank API returned invalid pagination metadata.",
                502,
                "WORLD_BANK_INVALID_METADATA",
            )

        if records is None:
            return metadata, []

        if not isinstance(records, list):
            raise WorldBankServiceError(
                "The World Bank API returned invalid data rows.",
                502,
                "WORLD_BANK_INVALID_ROWS",
            )

        normalized_records = [record for record in records if isinstance(record, dict)]
        return metadata, normalized_records

    def _normalize_countries(self, records: list[dict[str, Any]]) -> list[MetadataOption]:
        normalized: list[MetadataOption] = []
        seen: set[str] = set()

        for record in records:
            code = sanitize_text(record.get("id")).upper()
            label = sanitize_text(record.get("name"))
            if not code or not label or code in seen:
                continue
            seen.add(code)
            normalized.append(MetadataOption(label=label, value=code))

        return sorted(normalized, key=option_sort_key)

    def _normalize_indicators(self, records: list[dict[str, Any]]) -> list[MetadataOption]:
        normalized: list[MetadataOption] = []
        seen: set[str] = set()

        for record in records:
            code = sanitize_text(record.get("id"))
            label = sanitize_text(record.get("name"))
            if not code or not label or code in seen:
                continue
            seen.add(code)
            normalized.append(MetadataOption(label=label, value=code))

        return sorted(normalized, key=option_sort_key)

    def _normalize_rows(
        self,
        records: list[dict[str, Any]],
        *,
        indicator_label: str,
        country_lookup: dict[str, MetadataOption],
    ) -> list[WorldBankRow]:
        rows: list[WorldBankRow] = []

        for record in records:
            raw_value = record.get("value")
            if raw_value in (None, ""):
                continue

            try:
                numeric_value = float(raw_value)
            except (TypeError, ValueError):
                continue

            if math.isnan(numeric_value):
                continue

            try:
                year = int(str(record.get("date")))
            except (TypeError, ValueError):
                continue

            country_entry = record.get("country")
            country_code = ""
            country_label = ""
            if isinstance(country_entry, dict):
                country_code = sanitize_text(country_entry.get("id")).upper()
                country_label = sanitize_text(country_entry.get("value"))

            if not country_label and country_code in country_lookup:
                country_label = country_lookup[country_code].label

            if not country_label:
                continue

            rows.append(
                WorldBankRow(
                    country=country_label,
                    indicator=indicator_label,
                    year=year,
                    value=numeric_value,
                )
            )

        return rows

    def _validate_selection(
        self,
        metadata: WorldBankMetadataResponse,
        request: WorldBankDataRequest,
    ) -> tuple[dict[str, MetadataOption], dict[str, MetadataOption]]:
        countries_by_code = {option.value: option for option in metadata.countries}
        indicators_by_code = {option.value: option for option in metadata.indicators}

        missing_countries = [code for code in request.countries if code not in countries_by_code]
        if missing_countries:
            raise WorldBankServiceError(
                "One or more selected countries are not available in the World Bank catalog.",
                400,
                "COUNTRY_NOT_FOUND",
                details=", ".join(missing_countries),
            )

        missing_indicators = [code for code in request.indicators if code not in indicators_by_code]
        if missing_indicators:
            raise WorldBankServiceError(
                "One or more selected indicators are not available in the World Bank catalog.",
                400,
                "INDICATOR_NOT_FOUND",
                details=", ".join(missing_indicators),
            )

        return countries_by_code, indicators_by_code

    async def _get_latest_years_rows(
        self,
        *,
        request: WorldBankDataRequest,
        countries_by_code: dict[str, MetadataOption],
        indicators_by_code: dict[str, MetadataOption],
    ) -> tuple[list[WorldBankRow], list[str]]:
        latest_years = request.years or 1
        current_year = time.gmtime().tm_year
        target_start_year = current_year - latest_years + 1
        requested_window_rows = await self._fetch_selection_rows(
            countries=request.countries,
            indicators=request.indicators,
            countries_by_code=countries_by_code,
            indicators_by_code=indicators_by_code,
            date_param=f"{target_start_year}:{current_year}",
        )
        grouped_rows = self._group_rows_by_pair(requested_window_rows)

        selected_rows: list[WorldBankRow] = []
        warnings: list[str] = []
        fallback_requests_by_indicator: dict[str, list[str]] = {}

        for country_code in request.countries:
            country_label = countries_by_code[country_code].label
            for indicator_code in request.indicators:
                indicator_label = indicators_by_code[indicator_code].label
                pair = (country_label, indicator_label)
                pair_rows = sorted(grouped_rows.get(pair, []), key=lambda row: row.year)

                if len(pair_rows) >= latest_years:
                    selected_rows.extend(pair_rows[-latest_years:])
                    continue

                fallback_requests_by_indicator.setdefault(indicator_code, []).append(country_code)

        for indicator_index, indicator_code in enumerate(request.indicators):
            fallback_country_codes = fallback_requests_by_indicator.get(indicator_code, [])
            if not fallback_country_codes:
                continue

            indicator_label = indicators_by_code[indicator_code].label
            fallback_batches = chunk_values(fallback_country_codes, COUNTRY_BATCH_SIZE)

            for batch_index, country_batch in enumerate(fallback_batches):
                fallback_rows = await self._fetch_indicator_rows(
                    country_batch=country_batch,
                    indicator_code=indicator_code,
                    indicator_label=indicator_label,
                    country_lookup=countries_by_code,
                    date_param=None,
                )
                fallback_grouped_rows = self._group_rows_by_pair(fallback_rows)

                for country_code in country_batch:
                    country_label = countries_by_code[country_code].label
                    pair = (country_label, indicator_label)
                    pair_rows = sorted(fallback_grouped_rows.get(pair, []), key=lambda row: row.year)

                    if not pair_rows:
                        warnings.append(
                            f"{pair[0]} / {pair[1]}: data is not available for the latest {latest_years} years, and no historical values were found."
                        )
                        continue

                    selected_pair_rows = pair_rows[-min(latest_years, len(pair_rows)) :]
                    selected_rows.extend(selected_pair_rows)
                    start_year = selected_pair_rows[0].year
                    end_year = selected_pair_rows[-1].year

                    if len(selected_pair_rows) < latest_years:
                        warnings.append(
                            f"{pair[0]} / {pair[1]}: data is not available for the latest {latest_years} years. Exporting {len(selected_pair_rows)} available years instead ({start_year}-{end_year})."
                        )
                    else:
                        warnings.append(
                            f"{pair[0]} / {pair[1]}: data is not available for the latest {latest_years} years. Exporting the last {latest_years} available years instead ({start_year}-{end_year})."
                        )

                if self._should_pause_between_batches(indicator_index, batch_index, len(request.indicators), len(fallback_batches)):
                    await asyncio.sleep(BATCH_DELAY_SECONDS)

        selected_rows.sort(key=lambda row: (row.country.casefold(), row.indicator.casefold(), row.year))
        return self._dedupe_rows(selected_rows), warnings

    def _group_rows_by_pair(self, rows: list[WorldBankRow]) -> dict[tuple[str, str], list[WorldBankRow]]:
        grouped_rows: dict[tuple[str, str], list[WorldBankRow]] = {}

        for row in rows:
            grouped_rows.setdefault((row.country, row.indicator), []).append(row)

        return grouped_rows

    def _dedupe_rows(self, rows: list[WorldBankRow]) -> list[WorldBankRow]:
        deduped_rows: list[WorldBankRow] = []
        seen: set[tuple[str, str, int]] = set()

        for row in rows:
            dedupe_key = (row.country.casefold(), row.indicator.casefold(), row.year)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            deduped_rows.append(row)

        return deduped_rows

    def _expand_rows_for_custom_range(
        self,
        rows: list[WorldBankRow],
        expected_pairs: list[tuple[str, str]],
        start_year: int,
        end_year: int,
    ) -> list[WorldBankRow]:
        grouped_rows = self._group_rows_by_pair(rows)
        expanded_rows: list[WorldBankRow] = []

        for country_label, indicator_label in expected_pairs:
            pair_rows = grouped_rows.get((country_label, indicator_label), [])
            rows_by_year = {row.year: row for row in pair_rows}

            for year in range(start_year, end_year + 1):
                expanded_rows.append(
                    rows_by_year.get(
                        year,
                        WorldBankRow(
                            country=country_label,
                            indicator=indicator_label,
                            year=year,
                            value=None,
                        ),
                    )
                )

        expanded_rows.sort(key=lambda row: (row.country.casefold(), row.indicator.casefold(), row.year))
        return self._dedupe_rows(expanded_rows)

    def _build_custom_range_warnings(
        self,
        rows: list[WorldBankRow],
        expected_pairs: list[tuple[str, str]],
    ) -> list[str]:
        grouped_rows = self._group_rows_by_pair(rows)
        warnings: list[str] = []

        for country_label, indicator_label in expected_pairs:
            pair_rows = grouped_rows.get((country_label, indicator_label), [])

            if not pair_rows or not any(row.value is not None for row in pair_rows):
                warnings.append(f"{country_label} / {indicator_label}: no data was returned for the selected range.")
                continue

            if any(row.value is None for row in pair_rows):
                warnings.append(
                    f"{country_label} / {indicator_label}: some years in the selected range did not return values and were left blank."
                )

        return warnings

    def _build_missing_pair_warnings(
        self,
        rows: list[WorldBankRow],
        expected_pairs: list[tuple[str, str]],
    ) -> list[str]:
        available_pairs = {(row.country, row.indicator) for row in rows}
        warnings: list[str] = []

        for country_label, indicator_label in expected_pairs:
            if (country_label, indicator_label) not in available_pairs:
                warnings.append(f"{country_label} / {indicator_label}: no data was returned for the selected range.")

        return warnings

    def _should_pause_between_batches(
        self,
        indicator_index: int,
        batch_index: int,
        indicator_count: int,
        batch_count: int,
    ) -> bool:
        return indicator_index < indicator_count - 1 or batch_index < batch_count - 1

    def _utc_now(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import Any

import httpx

from app.models.request_models import MetadataOption
from app.models.worldbank_models import WorldBankDataRequest, WorldBankDataResponse, WorldBankMetadataResponse, WorldBankRow
from app.utils.cache import TTLCache
from app.utils.retry import RetryableUpstreamError, run_with_retry


logger = logging.getLogger(__name__)

WORLD_BANK_BASE_URL = "https://api.worldbank.org/v2"
COUNTRIES_CACHE_KEY = "worldbank-metadata"
METADATA_TTL_SECONDS = 24 * 60 * 60
COUNTRIES_PER_PAGE = 1000
INDICATORS_PER_PAGE = 20000
DATA_PER_PAGE = 1000
MAX_CONCURRENT_REQUESTS = 4
COUNTRY_BATCH_SIZE = 40


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
            countries_task = self._fetch_paginated_items(
                "/country",
                {"format": "json", "per_page": COUNTRIES_PER_PAGE},
                "world bank countries metadata",
            )
            indicators_task = self._fetch_paginated_items(
                "/indicator",
                {"format": "json", "per_page": INDICATORS_PER_PAGE},
                "world bank indicators metadata",
            )
            countries_records, indicators_records = await asyncio.gather(countries_task, indicators_task)

            payload = WorldBankMetadataResponse(
                countries=self._normalize_countries(countries_records),
                indicators=self._normalize_indicators(indicators_records),
                lastUpdated=self._utc_now(),
            )
            self._metadata_cache.set(COUNTRIES_CACHE_KEY, payload)
            return payload

    async def get_data(self, request: WorldBankDataRequest) -> WorldBankDataResponse:
        metadata = await self.get_metadata()
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

        if request.latest_years is not None:
            rows, warnings = await self._get_latest_years_rows(
                request=request,
                countries_by_code=countries_by_code,
                indicators_by_code=indicators_by_code,
            )
        else:
            date_param = None
            if request.start_year is not None and request.end_year is not None:
                date_param = f"{request.start_year}:{request.end_year}"

            raw_rows = await self._fetch_selection_rows(
                countries=request.countries,
                indicators=request.indicators,
                countries_by_code=countries_by_code,
                indicators_by_code=indicators_by_code,
                date_param=date_param,
            )
            expected_pairs = [
                (countries_by_code[country_code].label, indicators_by_code[indicator_code].label)
                for country_code in request.countries
                for indicator_code in request.indicators
            ]
            rows = sorted(raw_rows, key=lambda row: (row.country.casefold(), row.indicator.casefold(), row.year))
            warnings = self._build_missing_pair_warnings(rows, expected_pairs)

        if not rows:
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

    async def _fetch_selection_rows(
        self,
        *,
        countries: list[str],
        indicators: list[str],
        countries_by_code: dict[str, MetadataOption],
        indicators_by_code: dict[str, MetadataOption],
        date_param: str | None,
    ) -> list[WorldBankRow]:
        tasks = []
        for indicator_code in indicators:
            for country_batch in chunk_values(countries, COUNTRY_BATCH_SIZE):
                tasks.append(
                    self._fetch_indicator_rows(
                        country_batch=country_batch,
                        indicator_code=indicator_code,
                        indicator_label=indicators_by_code[indicator_code].label,
                        country_lookup=countries_by_code,
                        date_param=date_param,
                    )
                )

        batches = await asyncio.gather(*tasks)
        return self._dedupe_rows([row for batch in batches for row in batch])

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

        records = first_items
        if total_pages == 1:
            return records

        page_tasks = [
            self._request_json(path, {**params, "page": page_number}, f"{request_label} page={page_number}")
            for page_number in range(2, total_pages + 1)
        ]

        for payload in await asyncio.gather(*page_tasks):
            _, page_items = self._parse_paginated_payload(payload)
            records.extend(page_items)

        return records

    async def _request_json(
        self,
        path: str,
        params: dict[str, str | int],
        request_label: str,
    ) -> Any:
        async def operation() -> Any:
            url = f"{WORLD_BANK_BASE_URL}{path}"
            started_at = time.perf_counter()
            logger.info("world bank request started label=%s url=%s params=%s", request_label, url, params)

            async with self._request_semaphore:
                response = await self._client.get(url, params=params)

            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.info(
                "world bank response received label=%s status=%s elapsed_ms=%.2f",
                request_label,
                response.status_code,
                elapsed_ms,
            )

            if response.status_code >= 500:
                raise RetryableUpstreamError(f"World Bank API returned status {response.status_code} for {request_label}.")

            if response.status_code == 404:
                raise WorldBankServiceError("No data available for this World Bank request.", 404, "NO_DATA")

            if response.status_code >= 400:
                raise WorldBankServiceError(
                    "The World Bank API rejected the request.",
                    response.status_code,
                    "WORLD_BANK_UPSTREAM_CLIENT_ERROR",
                    details=f"Path {path} returned {response.status_code}.",
                )

            try:
                payload = response.json()
            except ValueError as exc:
                raise WorldBankServiceError(
                    "The World Bank API returned invalid JSON.",
                    502,
                    "WORLD_BANK_INVALID_JSON",
                    str(exc),
                ) from exc

            return payload

        try:
            return await run_with_retry(request_label, operation)
        except WorldBankServiceError:
            raise
        except httpx.TimeoutException as exc:
            raise WorldBankServiceError("The World Bank API timed out while processing the request.", 504, "WORLD_BANK_TIMEOUT") from exc
        except httpx.NetworkError as exc:
            raise WorldBankServiceError("Unable to reach the World Bank API right now.", 503, "WORLD_BANK_NETWORK_ERROR") from exc
        except RetryableUpstreamError as exc:
            raise WorldBankServiceError(
                "The World Bank API is temporarily unavailable.",
                502,
                "WORLD_BANK_UPSTREAM_UNAVAILABLE",
            ) from exc

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

    async def _get_latest_years_rows(
        self,
        *,
        request: WorldBankDataRequest,
        countries_by_code: dict[str, MetadataOption],
        indicators_by_code: dict[str, MetadataOption],
    ) -> tuple[list[WorldBankRow], list[str]]:
        latest_years = request.latest_years or 1
        current_year = time.gmtime().tm_year
        target_start_year = current_year - latest_years + 1
        requested_window_rows = await self._fetch_selection_rows(
            countries=request.countries,
            indicators=request.indicators,
            countries_by_code=countries_by_code,
            indicators_by_code=indicators_by_code,
            date_param=f"{target_start_year}:{current_year}",
        )
        grouped_rows: dict[tuple[str, str], list[WorldBankRow]] = {}

        for row in requested_window_rows:
            grouped_rows.setdefault((row.country, row.indicator), []).append(row)

        selected_rows: list[WorldBankRow] = []
        warnings: list[str] = []
        fallback_tasks = []
        fallback_pairs: list[tuple[str, str]] = []

        for country_code in request.countries:
            country_label = countries_by_code[country_code].label
            for indicator_code in request.indicators:
                indicator_label = indicators_by_code[indicator_code].label
                pair = (country_label, indicator_label)
                pair_rows = sorted(grouped_rows.get(pair, []), key=lambda row: row.year)

                if len(pair_rows) >= latest_years:
                    selected_rows.extend(pair_rows[-latest_years:])
                    continue

                fallback_pairs.append(pair)
                fallback_tasks.append(
                    self._fetch_indicator_rows(
                        country_batch=[country_code],
                        indicator_code=indicator_code,
                        indicator_label=indicator_label,
                        country_lookup=countries_by_code,
                        date_param=None,
                    )
                )

        fallback_batches = await asyncio.gather(*fallback_tasks)

        for pair, fallback_rows in zip(fallback_pairs, fallback_batches):
            pair_rows = sorted(fallback_rows, key=lambda row: row.year)
            if not pair_rows:
                warnings.append(
                    f"{pair[0]} / {pair[1]}: data is not available for the latest {latest_years} years, and no historical values were found."
                )
                continue

            fallback_rows = pair_rows[-min(latest_years, len(pair_rows)) :]
            selected_rows.extend(fallback_rows)
            start_year = fallback_rows[0].year
            end_year = fallback_rows[-1].year

            if len(fallback_rows) < latest_years:
                warnings.append(
                    f"{pair[0]} / {pair[1]}: data is not available for the latest {latest_years} years. Exporting {len(fallback_rows)} available years instead ({start_year}-{end_year})."
                )
            else:
                warnings.append(
                    f"{pair[0]} / {pair[1]}: data is not available for the latest {latest_years} years. Exporting the last {latest_years} available years instead ({start_year}-{end_year})."
                )

        selected_rows.sort(key=lambda row: (row.country.casefold(), row.indicator.casefold(), row.year))
        return selected_rows, warnings

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

    def _utc_now(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

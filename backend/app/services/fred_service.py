from __future__ import annotations

import asyncio
import logging
import math
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.models.request_models import AvailableYearRangeResponse
from app.models.fred_models import FredSearchResult, FredSeriesRow
from app.utils.cache import TTLCache
from app.utils.retry import RetryableUpstreamError, run_with_retry


logger = logging.getLogger(__name__)

FRED_BASE_URL = "https://api.stlouisfed.org/fred"
SEARCH_TTL_SECONDS = 15 * 60
SERIES_TTL_SECONDS = 60 * 60
MAX_CONCURRENT_REQUESTS = 4
DEFAULT_SEARCH_LIMIT = 30


class FREDServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500, code: str = "FRED_SERVICE_ERROR", details: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


@dataclass(slots=True)
class FredSeriesMetadata:
    series_id: str
    title: str
    frequency: str


@dataclass(slots=True)
class FredSeriesPayload:
    series_id: str
    title: str
    frequency: str
    rows: list[FredSeriesRow]
    last_updated: str


def sanitize_text(value: object) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()


def normalize_series_id(value: str | None) -> str:
    return sanitize_text(value).upper()


def select_latest_fred_rows(rows: list[FredSeriesRow], latest_years: int) -> tuple[list[FredSeriesRow], str | None]:
    if not rows:
        return [], None

    current_year = time.gmtime().tm_year
    target_start_year = current_year - latest_years + 1
    requested_window_rows = [
        row for row in rows if target_start_year <= int(row.date) <= current_year and row.value is not None
    ]

    if len(requested_window_rows) >= latest_years:
        return requested_window_rows[-latest_years:], None

    fallback_rows = rows[-min(latest_years, len(rows)) :]
    first_row = rows[0]
    start_year = fallback_rows[0].date
    end_year = fallback_rows[-1].date

    if len(fallback_rows) < latest_years:
        warning = (
            f"{first_row.title} ({first_row.series_id}) did not have data for the latest {latest_years} years. "
            f"Using {len(fallback_rows)} available years instead ({start_year}-{end_year})."
        )
    else:
        warning = (
            f"{first_row.title} ({first_row.series_id}) did not have data for the latest {latest_years} years. "
            f"Using the last {latest_years} available years instead ({start_year}-{end_year})."
        )

    return fallback_rows, warning


def build_custom_fred_warning(rows: list[FredSeriesRow]) -> str | None:
    if not rows:
        return None

    first_row = rows[0]
    if not any(row.value is not None for row in rows):
        return f"{first_row.title} ({first_row.series_id}) had no data in the selected range."

    if any(row.value is None for row in rows):
        return f"{first_row.title} ({first_row.series_id}) has blank years in the selected range."

    return None


class FREDService:
    def __init__(self, client: httpx.AsyncClient):
        self._client = client
        self._api_key = os.getenv("FRED_API_KEY", "").strip()
        self._search_cache = TTLCache[list[FredSearchResult]](SEARCH_TTL_SECONDS)
        self._metadata_cache = TTLCache[FredSeriesMetadata](SERIES_TTL_SECONDS)
        self._series_cache = TTLCache[FredSeriesPayload](SERIES_TTL_SECONDS)
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()
        self._request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async def search_series(self, query: str) -> list[FredSearchResult]:
        self._ensure_api_key()
        normalized_query = sanitize_text(query)

        if not normalized_query:
            return []

        cache_key = normalized_query.casefold()
        cached = self._search_cache.get(cache_key)
        if cached is not None:
            logger.info("fred search cache hit query=%s", normalized_query)
            return cached

        lock = await self._get_lock(f"search:{cache_key}")
        async with lock:
            cached = self._search_cache.get(cache_key)
            if cached is not None:
                logger.info("fred search cache hit after lock query=%s", normalized_query)
                return cached

            payload = await self._request_json(
                "/series/search",
                {
                    "api_key": self._api_key,
                    "file_type": "json",
                    "limit": DEFAULT_SEARCH_LIMIT,
                    "search_text": normalized_query,
                },
                f"fred search {normalized_query}",
            )
            results = self._normalize_search_results(payload)
            self._search_cache.set(cache_key, results)
            return results

    async def get_series_data(
        self,
        series_id: str,
        start_year: int | None = None,
        end_year: int | None = None,
    ) -> list[FredSeriesRow]:
        payload = await self._get_series_payload(series_id)

        if start_year is None or end_year is None:
            return list(payload.rows)

        values_by_year = {int(row.date): row.value for row in payload.rows}
        return [
            FredSeriesRow(
                series_id=payload.series_id,
                title=payload.title,
                date=str(year),
                value=values_by_year.get(year),
            )
            for year in range(start_year, end_year + 1)
        ]

    async def get_multiple_series(self, series_ids: list[str]) -> list[FredSeriesRow]:
        unique_series_ids = list(dict.fromkeys(normalize_series_id(series_id) for series_id in series_ids if normalize_series_id(series_id)))
        series_rows = await asyncio.gather(*(self.get_series_data(series_id) for series_id in unique_series_ids))

        flattened_rows = [row for rows in series_rows for row in rows]
        flattened_rows.sort(key=lambda row: (row.title.casefold(), row.series_id.casefold(), int(row.date)))
        return flattened_rows

    async def get_series_year_range(self, series_ids: list[str]) -> AvailableYearRangeResponse:
        rows = await self.get_multiple_series(series_ids)
        available_years = sorted({int(row.date) for row in rows if row.value is not None})

        if not available_years:
            raise FREDServiceError(
                "No FRED data is available for the selected series.",
                404,
                "NO_DATA",
            )

        return AvailableYearRangeResponse(
            startYear=available_years[0],
            endYear=available_years[-1],
            lastUpdated=self._utc_now(),
        )

    async def _get_series_payload(self, series_id: str) -> FredSeriesPayload:
        self._ensure_api_key()
        normalized_series_id = normalize_series_id(series_id)
        if not normalized_series_id:
            raise FREDServiceError("A FRED series ID is required.", 400, "SERIES_NOT_FOUND")

        cached = self._series_cache.get(normalized_series_id)
        if cached is not None:
            logger.info("fred series cache hit series_id=%s", normalized_series_id)
            return cached

        lock = await self._get_lock(f"series:{normalized_series_id}")
        async with lock:
            cached = self._series_cache.get(normalized_series_id)
            if cached is not None:
                logger.info("fred series cache hit after lock series_id=%s", normalized_series_id)
                return cached

            metadata, observations = await asyncio.gather(
                self._get_series_metadata(normalized_series_id),
                self._get_series_observations(normalized_series_id),
            )

            payload = FredSeriesPayload(
                series_id=metadata.series_id,
                title=metadata.title,
                frequency=metadata.frequency,
                rows=[
                    FredSeriesRow(
                        series_id=metadata.series_id,
                        title=metadata.title,
                        date=str(year),
                        value=value,
                    )
                    for year, value in observations
                ],
                last_updated=self._utc_now(),
            )
            self._series_cache.set(normalized_series_id, payload)
            return payload

    async def _get_series_metadata(self, series_id: str) -> FredSeriesMetadata:
        cached = self._metadata_cache.get(series_id)
        if cached is not None:
            return cached

        lock = await self._get_lock(f"metadata:{series_id}")
        async with lock:
            cached = self._metadata_cache.get(series_id)
            if cached is not None:
                return cached

            payload = await self._request_json(
                "/series",
                {
                    "api_key": self._api_key,
                    "file_type": "json",
                    "series_id": series_id,
                },
                f"fred metadata {series_id}",
            )
            metadata = self._normalize_series_metadata(payload, series_id)
            self._metadata_cache.set(series_id, metadata)
            return metadata

    async def _get_series_observations(self, series_id: str) -> list[tuple[int, float]]:
        payload = await self._request_json(
            "/series/observations",
            {
                "aggregation_method": "avg",
                "api_key": self._api_key,
                "file_type": "json",
                "frequency": "a",
                "series_id": series_id,
            },
            f"fred observations {series_id}",
        )
        return self._normalize_observations(payload)

    async def _get_lock(self, cache_key: str) -> asyncio.Lock:
        async with self._locks_guard:
            existing_lock = self._locks.get(cache_key)
            if existing_lock is not None:
                return existing_lock

            lock = asyncio.Lock()
            self._locks[cache_key] = lock
            return lock

    async def _request_json(
        self,
        path: str,
        params: dict[str, str | int],
        request_label: str,
    ) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            url = f"{FRED_BASE_URL}{path}"
            started_at = time.perf_counter()
            logger.info("fred request started label=%s url=%s params=%s", request_label, url, params)

            async with self._request_semaphore:
                response = await self._client.get(url, params=params)

            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.info(
                "fred response received label=%s status=%s elapsed_ms=%.2f",
                request_label,
                response.status_code,
                elapsed_ms,
            )

            if response.status_code == 429:
                raise RetryableUpstreamError(f"FRED API returned status 429 for {request_label}.")

            if response.status_code >= 500:
                raise RetryableUpstreamError(f"FRED API returned status {response.status_code} for {request_label}.")

            if response.status_code >= 400:
                raise FREDServiceError(
                    "The FRED API rejected the request.",
                    response.status_code,
                    "FRED_UPSTREAM_CLIENT_ERROR",
                    details=self._build_client_error_details(response),
                )

            try:
                payload = response.json()
            except ValueError as exc:
                raise FREDServiceError("The FRED API returned invalid JSON.", 502, "FRED_INVALID_JSON", str(exc)) from exc

            if not isinstance(payload, dict):
                raise FREDServiceError("The FRED API returned an unexpected payload.", 502, "FRED_INVALID_PAYLOAD")

            return payload

        try:
            return await run_with_retry(request_label, operation)
        except FREDServiceError:
            raise
        except httpx.TimeoutException as exc:
            raise FREDServiceError("The FRED API timed out while processing the request.", 504, "FRED_TIMEOUT") from exc
        except httpx.NetworkError as exc:
            raise FREDServiceError("Unable to reach the FRED API right now.", 503, "FRED_NETWORK_ERROR") from exc
        except RetryableUpstreamError as exc:
            raise FREDServiceError("The FRED API is temporarily unavailable.", 502, "FRED_UPSTREAM_UNAVAILABLE") from exc

    def _normalize_search_results(self, payload: dict[str, Any]) -> list[FredSearchResult]:
        raw_series = payload.get("seriess")
        if not isinstance(raw_series, list):
            raise FREDServiceError("Unable to load FRED search results.", 502, "FRED_INVALID_SEARCH_PAYLOAD")

        normalized_results: list[FredSearchResult] = []
        seen: set[str] = set()

        for entry in raw_series:
            if not isinstance(entry, dict):
                continue

            series_id = normalize_series_id(entry.get("id"))
            title = sanitize_text(entry.get("title"))
            frequency = sanitize_text(entry.get("frequency"))

            if not series_id or not title or series_id in seen:
                continue

            seen.add(series_id)
            normalized_results.append(
                FredSearchResult(
                    id=series_id,
                    title=title,
                    frequency=frequency or "Unknown",
                )
            )

        return normalized_results

    def _normalize_series_metadata(self, payload: dict[str, Any], series_id: str) -> FredSeriesMetadata:
        raw_series = payload.get("seriess")
        if not isinstance(raw_series, list):
            raise FREDServiceError("The FRED API returned invalid series metadata.", 502, "FRED_INVALID_METADATA")

        metadata = next((entry for entry in raw_series if isinstance(entry, dict)), None)
        if metadata is None:
            raise FREDServiceError("The selected FRED series could not be found.", 404, "SERIES_NOT_FOUND", details=series_id)

        title = sanitize_text(metadata.get("title"))
        frequency = sanitize_text(metadata.get("frequency"))

        if not title:
            raise FREDServiceError("The selected FRED series returned incomplete metadata.", 502, "FRED_INVALID_METADATA")

        return FredSeriesMetadata(
            series_id=series_id,
            title=title,
            frequency=frequency or "Unknown",
        )

    def _normalize_observations(self, payload: dict[str, Any]) -> list[tuple[int, float]]:
        raw_observations = payload.get("observations")
        if not isinstance(raw_observations, list):
            raise FREDServiceError("The FRED API returned invalid observation data.", 502, "FRED_INVALID_OBSERVATIONS")

        rows_by_year: dict[int, float] = {}

        for entry in raw_observations:
            if not isinstance(entry, dict):
                continue

            raw_date = sanitize_text(entry.get("date"))
            raw_value = entry.get("value")

            if len(raw_date) < 4 or not raw_date[:4].isdigit() or raw_value in (None, "", "."):
                continue

            try:
                numeric_value = float(raw_value)
            except (TypeError, ValueError):
                continue

            if math.isnan(numeric_value):
                continue

            rows_by_year[int(raw_date[:4])] = numeric_value

        return sorted(rows_by_year.items())

    def _build_client_error_details(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return sanitize_text(response.text)[:200]

        if isinstance(payload, dict):
            error_message = sanitize_text(payload.get("error_message"))
            if error_message:
                return error_message

        return sanitize_text(response.text)[:200]

    def _ensure_api_key(self) -> None:
        if self._api_key:
            return

        raise FREDServiceError(
            "FRED API access is not configured on the backend.",
            500,
            "FRED_API_KEY_MISSING",
            details="Set the FRED_API_KEY environment variable.",
        )

    def _utc_now(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

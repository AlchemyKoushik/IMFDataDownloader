from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.models.fred_models import FredDataRequest, FredDataResponse, FredSearchResult, FredSeriesRow
from app.models.request_models import AvailableYearRangeResponse
from app.services.fred_service import FREDService, FREDServiceError, build_custom_fred_warning, select_latest_fred_rows
from app.utils.excel import build_fred_workbook


router = APIRouter(tags=["fred"])


def get_fred_service(request: Request) -> FREDService:
    return request.app.state.fred_service


async def build_fred_data_response(service: FREDService, payload: FredDataRequest) -> FredDataResponse:
    warnings: list[str] = []

    if payload.uses_custom_range():
        series_rows = await asyncio.gather(
            *(service.get_series_data(series_id, payload.start_year, payload.end_year) for series_id in payload.series_ids)
        )
        rows: list[FredSeriesRow] = []
        for selected_rows in series_rows:
            rows.extend(selected_rows)
            warning = build_custom_fred_warning(selected_rows)
            if warning:
                warnings.append(warning)
    elif payload.uses_preset_range():
        series_rows = await asyncio.gather(*(service.get_series_data(series_id) for series_id in payload.series_ids))
        rows = []
        for selected_rows in series_rows:
            next_rows, warning = select_latest_fred_rows(selected_rows, payload.years or 1)
            rows.extend(next_rows)
            if warning:
                warnings.append(warning)
    else:
        rows = await service.get_multiple_series(payload.series_ids)

    rows.sort(key=lambda row: (row.title.casefold(), row.series_id.casefold(), int(row.date)))

    has_any_values = any(row.value is not None for row in rows)
    includes_future_years = bool(payload.uses_custom_range() and (payload.end_year or 0) > time.gmtime().tm_year)

    if not rows or (not has_any_values and not includes_future_years):
        raise FREDServiceError(
            "No FRED data is available for the selected series and range filter.",
            404,
            "NO_DATA",
        )

    return FredDataResponse(
        rows=rows,
        totalRows=len(rows),
        warnings=warnings,
        lastUpdated=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@router.get("/search", response_model=list[FredSearchResult])
async def search_series(request: Request, q: str = Query(..., min_length=1)):
    service = get_fred_service(request)
    results = await service.search_series(q)
    return [result.model_dump() for result in results]


@router.post("/data", response_model=FredDataResponse)
async def get_fred_data(payload: FredDataRequest, request: Request):
    service = get_fred_service(request)
    response = await build_fred_data_response(service, payload)
    return response.model_dump(by_alias=True)


@router.post("/range", response_model=AvailableYearRangeResponse)
async def get_fred_year_range(payload: FredDataRequest, request: Request):
    service = get_fred_service(request)
    response = await service.get_series_year_range(payload.series_ids)
    return response.model_dump(by_alias=True)


@router.post("/download")
async def download_fred_data(payload: FredDataRequest, request: Request):
    service = get_fred_service(request)
    response = await build_fred_data_response(service, payload)
    file_buffer, file_name = build_fred_workbook(response.rows)

    return StreamingResponse(
        iter([file_buffer.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )

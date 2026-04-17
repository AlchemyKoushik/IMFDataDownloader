from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.models.request_models import (
    AvailableYearRangeResponse,
    BulkDataRequest,
    BulkSeriesResponse,
    DataRequest,
    MetadataResponse,
    SeriesResponse,
)
from app.services.imf_service import IMFService
from app.utils.excel import build_excel_workbook, build_imf_grid_workbook


router = APIRouter()


def get_imf_service(request: Request) -> IMFService:
    return request.app.state.imf_service


@router.get("/metadata", response_model=MetadataResponse)
async def get_metadata(request: Request):
    service = get_imf_service(request)
    payload = await service.get_metadata()
    return payload.model_dump(by_alias=True)


@router.post("/data", response_model=SeriesResponse)
async def get_data(payload: DataRequest, request: Request):
    service = get_imf_service(request)
    response = await service.get_series(payload)
    return response.model_dump(by_alias=True)


@router.post("/imf/bulk-data", response_model=BulkSeriesResponse)
async def get_bulk_data(payload: BulkDataRequest, request: Request):
    service = get_imf_service(request)
    response = await service.get_bulk_series(payload)
    return response.model_dump(by_alias=True)


@router.post("/imf/bulk-range", response_model=AvailableYearRangeResponse)
async def get_bulk_year_range(payload: BulkDataRequest, request: Request):
    service = get_imf_service(request)
    response = await service.get_bulk_year_range(payload)
    return response.model_dump(by_alias=True)


@router.post("/download")
async def download_data(payload: DataRequest, request: Request):
    service = get_imf_service(request)
    response = await service.get_series(payload)
    file_buffer, file_name = build_excel_workbook(
        country=response.country_label,
        indicator=response.indicator_label,
        observations=response.data,
    )

    headers = {
        "Content-Disposition": f'attachment; filename="{file_name}"',
        "X-Used-Fallback": str(response.used_fallback).lower(),
        "X-Resolved-Indicator": response.indicator_label,
        "X-Indicator-Code": response.indicator,
    }

    return StreamingResponse(
        iter([file_buffer.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.post("/imf/bulk-download")
async def download_bulk_data(payload: BulkDataRequest, request: Request):
    service = get_imf_service(request)
    response = await service.get_bulk_series(payload)
    file_buffer, file_name = build_imf_grid_workbook(response.rows)

    headers = {
        "Content-Disposition": f'attachment; filename="{file_name}"',
    }

    return StreamingResponse(
        iter([file_buffer.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )

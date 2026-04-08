from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.models.worldbank_models import WorldBankDataRequest, WorldBankDataResponse, WorldBankMetadataResponse
from app.services.worldbank_service import WorldBankService
from app.utils.excel import build_world_bank_workbook


router = APIRouter(prefix="/worldbank", tags=["worldbank"])


def get_worldbank_service(request: Request) -> WorldBankService:
    return request.app.state.worldbank_service


@router.get("/metadata", response_model=WorldBankMetadataResponse)
async def get_metadata(request: Request):
    service = get_worldbank_service(request)
    payload = await service.get_metadata()
    return payload.model_dump(by_alias=True)


@router.post("/data", response_model=WorldBankDataResponse)
async def get_data(payload: WorldBankDataRequest, request: Request):
    service = get_worldbank_service(request)
    response = await service.get_data(payload)
    return response.model_dump(by_alias=True)


@router.post("/download")
async def download_data(payload: WorldBankDataRequest, request: Request):
    service = get_worldbank_service(request)
    response = await service.get_data(payload)
    file_buffer, file_name = build_world_bank_workbook(response.rows)

    return StreamingResponse(
        iter([file_buffer.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )

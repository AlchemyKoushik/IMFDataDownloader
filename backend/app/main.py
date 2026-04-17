from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.models.request_models import ErrorResponse
from app.routes.data import router as data_router
from app.routes.fred import router as fred_router
from app.routes.worldbank import router as worldbank_router
from app.services.fred_service import FREDService, FREDServiceError
from app.services.imf_service import IMFService, IMFServiceError
from app.services.worldbank_service import WorldBankService, WorldBankServiceError


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

DEFAULT_ALLOWED_ORIGINS = [
    "https://data.alchemy-research.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def _get_allowed_origins() -> list[str]:
    configured = os.getenv("FRONTEND_ORIGINS")
    if not configured:
        return DEFAULT_ALLOWED_ORIGINS

    configured_origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    merged_origins = DEFAULT_ALLOWED_ORIGINS + configured_origins
    # Preserve order while removing duplicates.
    return list(dict.fromkeys(merged_origins))


@asynccontextmanager
async def lifespan(app: FastAPI):
    timeout = httpx.Timeout(30.0)
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        app.state.imf_service = IMFService(client)
        app.state.worldbank_service = WorldBankService(client)
        app.state.fred_service = FREDService(client)
        logger.info("FastAPI backend started")
        yield
    logger.info("FastAPI backend stopped")


app = FastAPI(
    title="Alchemy's Open Data Grid Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Used-Fallback", "X-Resolved-Indicator", "X-Indicator-Code"],
)

app.include_router(data_router)
app.include_router(fred_router, prefix="/fred")
app.include_router(worldbank_router)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    started_at = time.perf_counter()
    logger.info("request started method=%s path=%s", request.method, request.url.path)

    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.exception("request failed method=%s path=%s elapsed_ms=%.2f", request.method, request.url.path, elapsed_ms)
        raise

    elapsed_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "request completed method=%s path=%s status=%s elapsed_ms=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


@app.exception_handler(IMFServiceError)
async def handle_imf_service_error(_: Request, exc: IMFServiceError) -> JSONResponse:
    logger.warning("handled service error code=%s status=%s message=%s", exc.code, exc.status_code, exc.message)
    payload = ErrorResponse(code=exc.code, message=exc.message, details=exc.details)
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


@app.exception_handler(WorldBankServiceError)
async def handle_worldbank_service_error(_: Request, exc: WorldBankServiceError) -> JSONResponse:
    logger.warning("handled service error code=%s status=%s message=%s", exc.code, exc.status_code, exc.message)
    payload = ErrorResponse(code=exc.code, message=exc.message, details=exc.details)
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


@app.exception_handler(FREDServiceError)
async def handle_fred_service_error(_: Request, exc: FREDServiceError) -> JSONResponse:
    logger.warning("handled service error code=%s status=%s message=%s", exc.code, exc.status_code, exc.message)
    payload = ErrorResponse(code=exc.code, message=exc.message, details=exc.details)
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = "; ".join(
        f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in exc.errors()
    )
    payload = ErrorResponse(
        code="VALIDATION_ERROR",
        message="Invalid request payload.",
        details=details,
    )
    return JSONResponse(status_code=422, content=payload.model_dump())


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Alchemy's Open Data Grid backend is running."}

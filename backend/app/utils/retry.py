from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx
from tenacity import AsyncRetrying, RetryCallState, retry_if_exception, stop_after_attempt, wait_random_exponential


logger = logging.getLogger(__name__)
T = TypeVar("T")


class RetryableUpstreamError(Exception):
    pass


def _is_retryable_exception(error: BaseException) -> bool:
    return isinstance(error, (httpx.TimeoutException, httpx.NetworkError, RetryableUpstreamError))


def _log_before_sleep(request_label: str) -> Callable[[RetryCallState], None]:
    def _log(retry_state: RetryCallState) -> None:
        error = retry_state.outcome.exception() if retry_state.outcome else None
        logger.warning(
            "retrying imf request label=%s attempt=%s error=%s",
            request_label,
            retry_state.attempt_number,
            error,
        )

    return _log


async def run_with_retry(request_label: str, operation: Callable[[], Awaitable[T]]) -> T:
    retrying = AsyncRetrying(
        stop=stop_after_attempt(4),
        wait=wait_random_exponential(multiplier=1, max=8),
        retry=retry_if_exception(_is_retryable_exception),
        before_sleep=_log_before_sleep(request_label),
        reraise=True,
    )

    async for attempt in retrying:
        with attempt:
            return await operation()

    raise RuntimeError("Retry loop exited without returning or raising.")

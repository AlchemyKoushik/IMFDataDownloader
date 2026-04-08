from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(slots=True)
class CacheEntry[T]:
    value: T
    expires_at: float


class TTLCache[T]:
    def __init__(self, ttl_seconds: int):
        self._ttl_seconds = ttl_seconds
        self._values: dict[str, CacheEntry[T]] = {}

    def get(self, key: str) -> T | None:
        entry = self._values.get(key)
        if entry is None:
            return None

        if entry.expires_at <= time.monotonic():
            self._values.pop(key, None)
            return None

        return entry.value

    def set(self, key: str, value: T) -> None:
        self._values[key] = CacheEntry(value=value, expires_at=time.monotonic() + self._ttl_seconds)

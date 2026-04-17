"use client";

import { downloadBackendFile, requestJson } from "@/lib/backendClient";
import type { AvailableYearRangePayload } from "@/types/dateFilter";
import type { FredDataRequestPayload, FredDataResponsePayload, FredSearchResult, FredSelectionPayload } from "@/types/fred";

const searchCache = new Map<string, FredSearchResult[]>();

export async function searchFredSeries(query: string, signal?: AbortSignal): Promise<FredSearchResult[]> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const cacheKey = normalizedQuery.toLowerCase();
  const cachedResults = searchCache.get(cacheKey);
  if (cachedResults) {
    return cachedResults;
  }

  const payload = await requestJson<FredSearchResult[]>(
    `/fred/search?q=${encodeURIComponent(normalizedQuery)}`,
    signal ? { signal } : undefined,
  );
  searchCache.set(cacheKey, payload);
  return payload;
}

export async function fetchFredData(payload: FredDataRequestPayload): Promise<FredDataResponsePayload> {
  return requestJson<FredDataResponsePayload>("/fred/data", {
    body: JSON.stringify(payload),
    method: "POST",
  });
}

export async function fetchFredSeriesRange(
  payload: FredSelectionPayload,
  signal?: AbortSignal,
): Promise<AvailableYearRangePayload> {
  return requestJson<AvailableYearRangePayload>("/fred/range", {
    body: JSON.stringify(payload),
    method: "POST",
    signal,
  });
}

export async function downloadFredExcel(payload: FredDataRequestPayload): Promise<string> {
  return downloadBackendFile("/fred/download", payload);
}

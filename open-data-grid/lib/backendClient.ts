"use client";

import type {
  ApiErrorPayload,
  ImfBulkDataRequestPayload,
  ImfBulkSelectionPayload,
  ImfBulkSeriesResponsePayload,
  MetadataResponsePayload,
  SeriesResponsePayload,
} from "@/types/imf";
import type { AvailableYearRangePayload } from "@/types/dateFilter";

const DEFAULT_API_BASE_URL = "http://localhost:8000";
const METADATA_STORAGE_KEY = "imf-metadata-cache-v4";
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedPayload<T> {
  expiresAt: number;
  payload: T;
}

export class BackendClientError extends Error {
  public readonly code: string;
  public readonly details?: string;
  public readonly status: number;

  constructor(message: string, status = 500, code = "BACKEND_CLIENT_ERROR", details?: string) {
    super(message);
    this.name = "BackendClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let metadataMemoryCache: CachedPayload<MetadataResponsePayload> | null = null;

export const getApiBaseUrl = (): string =>
  (process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const createNetworkError = (baseUrl: string, error: unknown): BackendClientError =>
  new BackendClientError(
    `Unable to reach backend at ${baseUrl}.`,
    503,
    "BACKEND_UNREACHABLE",
    error instanceof Error ? error.message : undefined,
  );

const readStoredMetadata = (): MetadataResponsePayload | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(METADATA_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as CachedPayload<MetadataResponsePayload>;
    if (!parsed?.expiresAt || !parsed.payload || parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(METADATA_STORAGE_KEY);
      return null;
    }

    metadataMemoryCache = parsed;
    return parsed.payload;
  } catch {
    window.localStorage.removeItem(METADATA_STORAGE_KEY);
    return null;
  }
};

const writeStoredMetadata = (payload: MetadataResponsePayload): void => {
  if (typeof window === "undefined") {
    return;
  }

  const cachedPayload: CachedPayload<MetadataResponsePayload> = {
    expiresAt: Date.now() + METADATA_TTL_MS,
    payload,
  };

  metadataMemoryCache = cachedPayload;

  try {
    window.localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(cachedPayload));
  } catch {
    // Ignore localStorage failures and keep the in-memory cache.
  }
};

const getCachedMetadata = (): MetadataResponsePayload | null => {
  if (metadataMemoryCache && metadataMemoryCache.expiresAt > Date.now()) {
    return metadataMemoryCache.payload;
  }

  return readStoredMetadata();
};

const createBackendClientError = async (response: Response): Promise<BackendClientError> => {
  const responseText = await response.text();
  let message = "The backend request failed.";
  let code = "BACKEND_REQUEST_FAILED";
  let details: string | undefined;

  if (responseText.trim()) {
    try {
      const parsed = JSON.parse(responseText) as ApiErrorPayload;
      if (isRecord(parsed)) {
        message = typeof parsed.message === "string" ? parsed.message : message;
        code = typeof parsed.code === "string" ? parsed.code : code;
        details = typeof parsed.details === "string" ? parsed.details : undefined;
      }
    } catch {
      details = responseText;
    }
  }

  return new BackendClientError(message, response.status, code, details);
};

export const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const baseUrl = getApiBaseUrl();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers,
    });
  } catch (error) {
    throw createNetworkError(baseUrl, error);
  }

  if (!response.ok) {
    throw await createBackendClientError(response);
  }

  return (await response.json()) as T;
};

const extractFileName = (contentDisposition: string | null): string => {
  if (!contentDisposition) {
    return "imf_data.xlsx";
  }

  const match = contentDisposition.match(/filename=\"?([^";]+)\"?/i);
  return match?.[1] ?? "imf_data.xlsx";
};

const triggerBrowserDownload = (blob: Blob, fileName: string): void => {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
};

export const primeMetadataCache = (payload: MetadataResponsePayload): void => {
  writeStoredMetadata(payload);
};

export async function fetchMetadata(): Promise<MetadataResponsePayload> {
  const cachedMetadata = getCachedMetadata();
  if (cachedMetadata) {
    return cachedMetadata;
  }

  const payload = await requestJson<MetadataResponsePayload>("/metadata");
  writeStoredMetadata(payload);
  return payload;
}

export async function fetchSeriesData(country: string, indicator: string): Promise<SeriesResponsePayload> {
  return requestJson<SeriesResponsePayload>("/data", {
    method: "POST",
    body: JSON.stringify({
      country,
      indicator,
    }),
  });
}

export async function fetchBulkSeriesData(
  payload: ImfBulkDataRequestPayload,
): Promise<ImfBulkSeriesResponsePayload> {
  return requestJson<ImfBulkSeriesResponsePayload>("/imf/bulk-data", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchBulkSeriesRange(
  payload: ImfBulkSelectionPayload,
  signal?: AbortSignal,
): Promise<AvailableYearRangePayload> {
  return requestJson<AvailableYearRangePayload>("/imf/bulk-range", {
    body: JSON.stringify(payload),
    method: "POST",
    signal,
  });
}

export async function downloadSeriesExcel(country: string, indicator: string): Promise<string> {
  return downloadBackendFile("/download", {
    country,
    indicator,
  });
}

export async function downloadBulkSeriesExcel(payload: ImfBulkDataRequestPayload): Promise<string> {
  return downloadBackendFile("/imf/bulk-download", payload);
}

export async function downloadBackendFile(path: string, body: unknown): Promise<string> {
  const baseUrl = getApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw createNetworkError(baseUrl, error);
  }

  if (!response.ok) {
    throw await createBackendClientError(response);
  }

  const blob = await response.blob();
  const fileName = extractFileName(response.headers.get("Content-Disposition"));

  triggerBrowserDownload(blob, fileName);
  return fileName;
}

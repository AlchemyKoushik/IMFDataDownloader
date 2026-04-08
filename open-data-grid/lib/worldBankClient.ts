"use client";

import { downloadBackendFile, requestJson } from "@/lib/backendClient";
import type { WorldBankDataRequestPayload, WorldBankDataResponsePayload, WorldBankMetadataResponsePayload } from "@/types/worldbank";

const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedPayload<T> {
  expiresAt: number;
  payload: T;
}

let metadataMemoryCache: CachedPayload<WorldBankMetadataResponsePayload> | null = null;

const getCachedMetadata = (): WorldBankMetadataResponsePayload | null => {
  if (metadataMemoryCache && metadataMemoryCache.expiresAt > Date.now()) {
    return metadataMemoryCache.payload;
  }

  return null;
};

const writeCachedMetadata = (payload: WorldBankMetadataResponsePayload): void => {
  metadataMemoryCache = {
    expiresAt: Date.now() + METADATA_TTL_MS,
    payload,
  };
};

export async function fetchWorldBankMetadata(): Promise<WorldBankMetadataResponsePayload> {
  const cachedMetadata = getCachedMetadata();
  if (cachedMetadata) {
    return cachedMetadata;
  }

  const payload = await requestJson<WorldBankMetadataResponsePayload>("/worldbank/metadata");
  writeCachedMetadata(payload);
  return payload;
}

export async function fetchWorldBankData(
  payload: WorldBankDataRequestPayload,
): Promise<WorldBankDataResponsePayload> {
  return requestJson<WorldBankDataResponsePayload>("/worldbank/data", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function downloadWorldBankExcel(payload: WorldBankDataRequestPayload): Promise<string> {
  return downloadBackendFile("/worldbank/download", payload);
}

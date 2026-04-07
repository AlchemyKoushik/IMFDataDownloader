import {
  ImfCountriesResponse,
  ImfDataMapperResponse,
  ImfIndicatorsResponse,
  IndicatorOption,
  SelectOption,
} from "@/types/imf";
import { logger } from "@/utils/logger";

import { isAbortError, isRetryableRequestError, RequestError, retryWithBackoff } from "./retryHandler";

const IMF_BASE_URL = "https://www.imf.org/external/datamapper/api/v1";
const METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DATA_CACHE_TTL_MS = 60 * 60 * 1000;

const responseCache = new Map<string, { data: unknown; expiresAt: number }>();
const inFlightRequests = new Map<string, Promise<unknown>>();

const IMF_REQUEST_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.imf.org",
  Referer: "https://www.imf.org/",
  "User-Agent": "Mozilla/5.0",
};

const normalizeParam = (value: string): string => value.trim().toUpperCase();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const getCachedResponse = <T>(cacheKey: string): T | null => {
  const cached = responseCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }

  return cached.data as T;
};

const sanitizeText = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isAccessDeniedResponse = (responseText: string): boolean => {
  const normalized = sanitizeText(responseText).toLowerCase();

  return normalized.includes("access denied") || normalized.includes("you don't have permission");
};

const compareOptions = (left: SelectOption, right: SelectOption): number => {
  const labelComparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });

  if (labelComparison !== 0) {
    return labelComparison;
  }

  return left.value.localeCompare(right.value, undefined, { sensitivity: "base" });
};

interface FetchJsonOptions {
  cacheKey: string;
  invalidPayloadCode: string;
  invalidPayloadMessage: string;
  ttlMs: number;
  url: string;
}

async function fetchImfJson<T>({
  cacheKey,
  invalidPayloadCode,
  invalidPayloadMessage,
  ttlMs,
  url,
}: FetchJsonOptions): Promise<T> {
  const cached = getCachedResponse<T>(cacheKey);
  if (cached) {
    logger.info("Serving IMF resource from cache.", {
      cacheKey,
      url,
    });
    return cached;
  }

  const existingRequest = inFlightRequests.get(cacheKey);
  if (existingRequest) {
    logger.info("Reusing in-flight IMF request.", {
      cacheKey,
      url,
    });
    return existingRequest as Promise<T>;
  }

  const requestPromise = retryWithBackoff<T>(
    async ({ attempt, signal }) => {
      logger.info("Fetching IMF resource.", {
        attempt,
        cacheKey,
        url,
      });

      let response: Response;

      try {
        response = await fetch(url, {
          method: "GET",
          headers: IMF_REQUEST_HEADERS,
          cache: "no-store",
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw new RequestError("The IMF request timed out.", {
            code: "IMF_TIMEOUT",
            status: 504,
            retryable: true,
            cause: error,
          });
        }

        throw new RequestError("Unable to reach the IMF API.", {
          code: "IMF_NETWORK_FAILURE",
          status: 502,
          retryable: true,
          cause: error,
        });
      }

      const responseText = await response.text();

      if (response.status === 403 || isAccessDeniedResponse(responseText)) {
        throw new RequestError("The IMF API temporarily blocked the upstream request.", {
          code: "IMF_ACCESS_DENIED",
          status: 503,
          retryable: true,
        });
      }

      if (response.status >= 500) {
        throw new RequestError("The IMF API is temporarily unavailable.", {
          code: "IMF_UPSTREAM_5XX",
          status: 502,
          retryable: true,
        });
      }

      if (!response.ok) {
        throw new RequestError("The IMF API request failed.", {
          code: "IMF_INVALID_REQUEST",
          status: 502,
          retryable: false,
          cause: responseText,
        });
      }

      if (!responseText.trim()) {
        throw new RequestError("The IMF API returned an empty response.", {
          code: "IMF_EMPTY_RESPONSE",
          status: 502,
          retryable: true,
        });
      }

      let parsedResponse: unknown;

      try {
        parsedResponse = JSON.parse(responseText);
      } catch (error) {
        throw new RequestError("The IMF API returned malformed JSON.", {
          code: "IMF_MALFORMED_JSON",
          status: 502,
          retryable: true,
          cause: error,
        });
      }

      if (!parsedResponse || typeof parsedResponse !== "object") {
        throw new RequestError(invalidPayloadMessage, {
          code: invalidPayloadCode,
          status: 502,
          retryable: true,
        });
      }

      return parsedResponse as T;
    },
    {
      maxRetries: 2,
      backoffMs: [200, 600],
      timeoutMs: 10_000,
      shouldRetry: isRetryableRequestError,
    },
  )
    .then((data) => {
      responseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ttlMs,
      });

      return data;
    })
    .catch((error) => {
      logger.error("IMF request failed.", error, {
        cacheKey,
        url,
      });
      throw error;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function fetchImfCountries(): Promise<SelectOption[]> {
  const response = await fetchImfJson<ImfCountriesResponse>({
    cacheKey: "metadata:countries",
    invalidPayloadCode: "IMF_INVALID_COUNTRY_PAYLOAD",
    invalidPayloadMessage: "The IMF API returned malformed country metadata.",
    ttlMs: METADATA_CACHE_TTL_MS,
    url: `${IMF_BASE_URL}/countries`,
  });

  if (!response.countries || typeof response.countries !== "object") {
    throw new RequestError("The IMF API returned malformed country metadata.", {
      code: "IMF_INVALID_COUNTRY_PAYLOAD",
      status: 502,
      retryable: true,
    });
  }

  return Object.entries(response.countries)
    .filter(([value, entry]) => Boolean(value.trim()) && typeof entry?.label === "string" && Boolean(entry.label.trim()))
    .map(([value, entry]) => ({
      label: sanitizeText(entry.label as string),
      value: normalizeParam(value),
    }))
    .sort(compareOptions);
}

export async function fetchImfIndicators(): Promise<IndicatorOption[]> {
  const response = await fetchImfJson<ImfIndicatorsResponse>({
    cacheKey: "metadata:indicators",
    invalidPayloadCode: "IMF_INVALID_INDICATOR_PAYLOAD",
    invalidPayloadMessage: "The IMF API returned malformed indicator metadata.",
    ttlMs: METADATA_CACHE_TTL_MS,
    url: `${IMF_BASE_URL}/indicators`,
  });

  if (!response.indicators || typeof response.indicators !== "object") {
    throw new RequestError("The IMF API returned malformed indicator metadata.", {
      code: "IMF_INVALID_INDICATOR_PAYLOAD",
      status: 502,
      retryable: true,
    });
  }

  return Object.entries(response.indicators)
    .filter(([value, entry]) => Boolean(value.trim()) && typeof entry?.label === "string" && Boolean(entry.label.trim()))
    .map(([value, entry]) => ({
      label: sanitizeText(entry.label as string),
      value: normalizeParam(value),
      description: typeof entry.description === "string" ? sanitizeText(entry.description) : undefined,
      source: typeof entry.source === "string" ? sanitizeText(entry.source) : undefined,
      unit: typeof entry.unit === "string" ? sanitizeText(entry.unit) : undefined,
      dataset: typeof entry.dataset === "string" ? sanitizeText(entry.dataset) : undefined,
    }))
    .sort(compareOptions);
}

export async function fetchImfData(country: string, indicator: string): Promise<ImfDataMapperResponse> {
  const normalizedCountry = normalizeParam(country);
  const normalizedIndicator = normalizeParam(indicator);

  const response = await fetchImfJson<ImfDataMapperResponse>({
    cacheKey: `data:${normalizedCountry}:${normalizedIndicator}`,
    invalidPayloadCode: "IMF_INVALID_DATA_PAYLOAD",
    invalidPayloadMessage: "The IMF API returned malformed time-series data.",
    ttlMs: DATA_CACHE_TTL_MS,
    url: `${IMF_BASE_URL}/${encodeURIComponent(normalizedIndicator)}/${encodeURIComponent(normalizedCountry)}`,
  });

  const indicatorValues = response.values?.[normalizedIndicator];
  if (!isRecord(indicatorValues)) {
    throw new RequestError("No data available for the selected country and indicator.", {
      code: "NO_DATA",
      status: 404,
      retryable: false,
    });
  }

  const countryValues = indicatorValues[normalizedCountry];
  if (!isRecord(countryValues)) {
    throw new RequestError("No data available for the selected country and indicator.", {
      code: "NO_DATA",
      status: 404,
      retryable: false,
    });
  }

  return {
    api: response.api,
    values: {
      [normalizedIndicator]: {
        [normalizedCountry]: countryValues as Record<string, number | string | null>,
      },
    },
  };
}

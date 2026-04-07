import {
  ImfApiResponse,
  ImfCountriesResponse,
  ImfIndicatorsResponse,
  IndicatorOption,
  SelectOption,
} from "@/types/imf";
import { logger } from "@/utils/logger";

import { isAbortError, isRetryableRequestError, RequestError, retryWithBackoff } from "./retryHandler";

const IMF_BASE_URL = "https://www.imf.org/external/datamapper/api/v1";
const DATA_CACHE_TTL_MS = 5 * 60 * 1000;
const METADATA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const responseCache = new Map<string, { data: unknown; expiresAt: number }>();
const inFlightRequests = new Map<string, Promise<unknown>>();

const REQUEST_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "User-Agent": "Mozilla/5.0 (compatible; IMFDataDownloader/1.0)",
};

const normalizeParam = (value: string): string => value.trim().toUpperCase();

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

const buildRequestUrl = (country: string, indicator: string): string =>
  `${IMF_BASE_URL}/${encodeURIComponent(normalizeParam(indicator))}/${encodeURIComponent(normalizeParam(country))}`;

const sanitizeText = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const compareOptions = (left: SelectOption, right: SelectOption): number => {
  const labelComparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });

  if (labelComparison !== 0) {
    return labelComparison;
  }

  return left.value.localeCompare(right.value, undefined, { sensitivity: "base" });
};

interface FetchJsonOptions {
  cacheKey: string;
  url: string;
  ttlMs: number;
  invalidPayloadCode: string;
  invalidPayloadMessage: string;
}

async function fetchImfJson<T>({
  cacheKey,
  url,
  ttlMs,
  invalidPayloadCode,
  invalidPayloadMessage,
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
    logger.info("Reusing in-flight IMF resource request.", {
      cacheKey,
      url,
    });
    return existingRequest as Promise<T>;
  }

  const requestPromise = retryWithBackoff<T>(
    async ({ attempt, signal }) => {
      logger.info("Fetching IMF resource.", {
        cacheKey,
        attempt,
        url,
      });

      let response: Response;

      try {
        response = await fetch(url, {
          method: "GET",
          headers: REQUEST_HEADERS,
          cache: "no-store",
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw new RequestError("The IMF API request timed out.", {
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

      if (response.status >= 500) {
        throw new RequestError("The IMF API is temporarily unavailable.", {
          code: "IMF_UPSTREAM_5XX",
          status: 502,
          retryable: true,
        });
      }

      if (!response.ok) {
        throw new RequestError(
          response.status === 404
            ? "The selected country and indicator combination could not be found."
            : "The IMF API rejected this request. Please verify the selected values.",
          {
            code: response.status === 404 ? "IMF_SERIES_NOT_FOUND" : "IMF_INVALID_REQUEST",
            status: response.status === 404 ? 404 : 400,
            retryable: false,
          },
        );
      }

      const responseText = await response.text();
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
      maxRetries: 3,
      backoffMs: [500, 1000, 2000],
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

export async function fetchImfData(country: string, indicator: string): Promise<ImfApiResponse> {
  const normalizedCountry = normalizeParam(country);
  const normalizedIndicator = normalizeParam(indicator);

  return fetchImfJson<ImfApiResponse>({
    cacheKey: `data:${normalizedCountry}::${normalizedIndicator}`,
    url: buildRequestUrl(normalizedCountry, normalizedIndicator),
    ttlMs: DATA_CACHE_TTL_MS,
    invalidPayloadCode: "IMF_INVALID_PAYLOAD",
    invalidPayloadMessage: "The IMF API returned malformed data.",
  });
}

export async function fetchImfCountries(): Promise<SelectOption[]> {
  const response = await fetchImfJson<ImfCountriesResponse>({
    cacheKey: "metadata:countries",
    url: `${IMF_BASE_URL}/countries`,
    ttlMs: METADATA_CACHE_TTL_MS,
    invalidPayloadCode: "IMF_INVALID_COUNTRY_PAYLOAD",
    invalidPayloadMessage: "The IMF API returned malformed country metadata.",
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
      value: normalizeParam(value),
      label: sanitizeText(entry.label as string),
    }))
    .sort(compareOptions);
}

export async function fetchImfIndicators(): Promise<IndicatorOption[]> {
  const response = await fetchImfJson<ImfIndicatorsResponse>({
    cacheKey: "metadata:indicators",
    url: `${IMF_BASE_URL}/indicators`,
    ttlMs: METADATA_CACHE_TTL_MS,
    invalidPayloadCode: "IMF_INVALID_INDICATOR_PAYLOAD",
    invalidPayloadMessage: "The IMF API returned malformed indicator metadata.",
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
      value: normalizeParam(value),
      label: sanitizeText(entry.label as string),
      description: typeof entry.description === "string" ? sanitizeText(entry.description) : undefined,
      source: typeof entry.source === "string" ? sanitizeText(entry.source) : undefined,
      unit: typeof entry.unit === "string" ? sanitizeText(entry.unit) : undefined,
      dataset: typeof entry.dataset === "string" ? sanitizeText(entry.dataset) : undefined,
    }))
    .sort(compareOptions);
}

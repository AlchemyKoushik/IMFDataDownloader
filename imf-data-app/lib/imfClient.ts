import {
  DataResponsePayload,
  ImfCountriesResponse,
  ImfDataMapperResponse,
  ImfIndicatorsResponse,
  IndicatorOption,
  MetadataResponsePayload,
  SelectOption,
} from "@/types/imf";

const IMF_BASE_URL = "https://www.imf.org/external/datamapper/api/v1";
const PROXY_PREFIXES = ["https://api.allorigins.win/raw?url=", "https://corsproxy.io/?"];
const REQUEST_TIMEOUT_MS = 10_000;
const METADATA_STORAGE_KEY = "imf-metadata-cache-v3";
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const DATA_TTL_MS = 60 * 60 * 1000;
const REQUEST_DELAY_MS = 150;
const RETRY_DELAYS_MS = [300, 600];

interface CachedPayload<T> {
  expiresAt: number;
  payload: T;
}

export class ImfClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, status = 500, code = "IMF_CLIENT_ERROR") {
    super(message);
    this.name = "ImfClientError";
    this.code = code;
    this.status = status;
  }
}

const dataCache = new Map<string, CachedPayload<DataResponsePayload>>();
const inFlightDataRequests = new Map<string, Promise<DataResponsePayload>>();
let metadataMemoryCache: CachedPayload<MetadataResponsePayload> | null = null;
let metadataRequestPromise: Promise<MetadataResponsePayload> | null = null;
let countriesRequestPromise: Promise<SelectOption[]> | null = null;
let indicatorsRequestPromise: Promise<IndicatorOption[]> | null = null;

const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const normalizeCode = (value: string): string => value.trim().toUpperCase();

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

const isHtmlPayload = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
};

const isBlockedPayload = (value: string): boolean => {
  const normalized = sanitizeText(value).toLowerCase();

  return (
    normalized.includes("access denied") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("too many requests") ||
    normalized.includes("rate limit")
  );
};

const isProxyErrorPayload = (value: unknown): boolean =>
  isRecord(value) && (typeof value.error === "string" || (value.error === true && typeof value.message === "string"));

const createProxyUrl = (proxyPrefix: string, targetUrl: string): string => `${proxyPrefix}${encodeURIComponent(targetUrl)}`;

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
    // Ignore storage quota or privacy-mode failures and keep the in-memory cache.
  }
};

export const primeMetadataCache = (payload: MetadataResponsePayload): void => {
  writeStoredMetadata(payload);
};

const getCachedMetadata = (): MetadataResponsePayload | null => {
  if (metadataMemoryCache && metadataMemoryCache.expiresAt > Date.now()) {
    return metadataMemoryCache.payload;
  }

  return readStoredMetadata();
};

const getCachedDataPayload = (cacheKey: string): DataResponsePayload | null => {
  const cached = dataCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    dataCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
};

const fetchJsonFromProxy = async <T>(path: string, retries = 2): Promise<T> => {
  const targetUrl = `${IMF_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    for (const proxyPrefix of PROXY_PREFIXES) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        await wait(REQUEST_DELAY_MS);

        const response = await fetch(createProxyUrl(proxyPrefix, targetUrl), {
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new ImfClientError("Data temporarily unavailable.", response.status, "IMF_PROXY_UNAVAILABLE");
        }

        const responseText = await response.text();
        if (!responseText.trim()) {
          throw new ImfClientError("Data temporarily unavailable.", 503, "IMF_EMPTY_RESPONSE");
        }

        if (isHtmlPayload(responseText) || isBlockedPayload(responseText)) {
          throw new ImfClientError("Data temporarily unavailable.", 503, "IMF_BLOCKED");
        }

        let parsedResponse: unknown;

        try {
          parsedResponse = JSON.parse(responseText);
        } catch {
          throw new ImfClientError("Data temporarily unavailable.", 503, "IMF_INVALID_JSON");
        }

        if (isProxyErrorPayload(parsedResponse)) {
          throw new ImfClientError("Data temporarily unavailable.", 503, "IMF_PROXY_ERROR");
        }

        if (!isRecord(parsedResponse)) {
          throw new ImfClientError("Data temporarily unavailable.", 503, "IMF_INVALID_PAYLOAD");
        }

        return parsedResponse as T;
      } catch (error) {
        lastError = error;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    if (attempt < retries) {
      await wait(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 0);
    }
  }

  if (lastError instanceof ImfClientError) {
    throw lastError;
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new ImfClientError("Data temporarily unavailable.", 504, "IMF_TIMEOUT");
  }

  throw new ImfClientError("Data temporarily unavailable.", 503, "IMF_PROXY_FAILED");
};

const normalizeCountries = (response: ImfCountriesResponse): SelectOption[] => {
  if (!isRecord(response.countries)) {
    throw new ImfClientError("Unable to load the IMF catalog right now.", 502, "INVALID_COUNTRY_METADATA");
  }

  return Object.entries(response.countries)
    .filter(([value, entry]) => Boolean(value.trim()) && typeof entry?.label === "string" && Boolean(entry.label.trim()))
    .map(([value, entry]) => ({
      label: sanitizeText(entry.label as string),
      value: normalizeCode(value),
    }))
    .sort(compareOptions);
};

const normalizeIndicators = (response: ImfIndicatorsResponse): IndicatorOption[] => {
  if (!isRecord(response.indicators)) {
    throw new ImfClientError("Unable to load the IMF catalog right now.", 502, "INVALID_INDICATOR_METADATA");
  }

  return Object.entries(response.indicators)
    .filter(([value, entry]) => Boolean(value.trim()) && typeof entry?.label === "string" && Boolean(entry.label.trim()))
    .map(([value, entry]) => ({
      label: sanitizeText(entry.label as string),
      value: normalizeCode(value),
      description: typeof entry.description === "string" ? sanitizeText(entry.description) : undefined,
      source: typeof entry.source === "string" ? sanitizeText(entry.source) : undefined,
      unit: typeof entry.unit === "string" ? sanitizeText(entry.unit) : undefined,
      dataset: typeof entry.dataset === "string" ? sanitizeText(entry.dataset) : undefined,
    }))
    .sort(compareOptions);
};

const normalizeSeriesData = (
  response: ImfDataMapperResponse,
  country: string,
  indicator: string,
): DataResponsePayload => {
  const indicatorValues = response.values?.[indicator];
  if (!isRecord(indicatorValues)) {
    throw new ImfClientError("No data available for this dataset.", 404, "NO_DATA");
  }

  const countryValues = indicatorValues[country];
  if (!isRecord(countryValues)) {
    throw new ImfClientError("No data available for this dataset.", 404, "NO_DATA");
  }

  const rows = Object.entries(countryValues)
    .filter(([, rawValue]) => rawValue !== null && rawValue !== "")
    .map(([year, rawValue]) => ({
      year: Number.parseInt(year, 10),
      value: typeof rawValue === "number" ? rawValue : Number.parseFloat(String(rawValue)),
    }))
    .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.value))
    .sort((left, right) => left.year - right.year);

  if (!rows.length) {
    throw new ImfClientError("No data available for this dataset.", 404, "NO_DATA");
  }

  return {
    country,
    indicator,
    rows,
    lastUpdated: new Date().toISOString(),
  };
};

export async function fetchCountries(): Promise<SelectOption[]> {
  const cachedMetadata = getCachedMetadata();
  if (cachedMetadata) {
    return cachedMetadata.countries;
  }

  if (countriesRequestPromise) {
    return countriesRequestPromise;
  }

  countriesRequestPromise = fetchJsonFromProxy<ImfCountriesResponse>("/countries")
    .then((response) => normalizeCountries(response))
    .finally(() => {
      countriesRequestPromise = null;
    });

  return countriesRequestPromise;
}

export async function fetchIndicators(): Promise<IndicatorOption[]> {
  const cachedMetadata = getCachedMetadata();
  if (cachedMetadata) {
    return cachedMetadata.indicators;
  }

  if (indicatorsRequestPromise) {
    return indicatorsRequestPromise;
  }

  indicatorsRequestPromise = fetchJsonFromProxy<ImfIndicatorsResponse>("/indicators")
    .then((response) => normalizeIndicators(response))
    .finally(() => {
      indicatorsRequestPromise = null;
    });

  return indicatorsRequestPromise;
}

export async function fetchMetadata(): Promise<MetadataResponsePayload> {
  const cachedMetadata = getCachedMetadata();
  if (cachedMetadata) {
    return cachedMetadata;
  }

  if (metadataRequestPromise) {
    return metadataRequestPromise;
  }

  metadataRequestPromise = Promise.all([fetchCountries(), fetchIndicators()])
    .then(([countries, indicators]) => {
      const payload: MetadataResponsePayload = {
        countries,
        indicators,
        lastUpdated: new Date().toISOString(),
      };

      writeStoredMetadata(payload);
      return payload;
    })
    .finally(() => {
      metadataRequestPromise = null;
    });

  return metadataRequestPromise;
}

export async function fetchSeriesData(country: string, indicator: string): Promise<DataResponsePayload> {
  const normalizedCountry = normalizeCode(country);
  const normalizedIndicator = normalizeCode(indicator);
  const cacheKey = `${normalizedCountry}:${normalizedIndicator}`;

  const cached = getCachedDataPayload(cacheKey);
  if (cached) {
    return cached;
  }

  const existingRequest = inFlightDataRequests.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const requestPromise = fetchJsonFromProxy<ImfDataMapperResponse>(`/${normalizedIndicator}/${normalizedCountry}`)
    .then((response) => {
      const payload = normalizeSeriesData(response, normalizedCountry, normalizedIndicator);
      dataCache.set(cacheKey, {
        expiresAt: Date.now() + DATA_TTL_MS,
        payload,
      });
      return payload;
    })
    .finally(() => {
      inFlightDataRequests.delete(cacheKey);
    });

  inFlightDataRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

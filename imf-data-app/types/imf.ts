export interface ImfDataMapperResponse {
  values?: Record<string, Record<string, Record<string, number | string | null>>>;
  api?: {
    version?: string;
    "output-method"?: string;
  };
}

export interface ImfCountryEntryRaw {
  label?: string | null;
}

export interface ImfCountriesResponse {
  countries?: Record<string, ImfCountryEntryRaw>;
}

export interface ImfIndicatorEntryRaw {
  label?: string | null;
  description?: string | null;
  source?: string | null;
  unit?: string | null;
  dataset?: string | null;
}

export interface ImfIndicatorsResponse {
  indicators?: Record<string, ImfIndicatorEntryRaw>;
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface IndicatorOption extends SelectOption {
  description?: string;
  source?: string;
  unit?: string;
  dataset?: string;
}

export interface NormalizedObservation {
  year: number;
  value: number;
}

export interface DownloadObservation extends NormalizedObservation {
  country: string;
  indicator: string;
}

export interface MetadataResponsePayload {
  countries: SelectOption[];
  indicators: IndicatorOption[];
  lastUpdated: string;
}

export interface DataResponsePayload {
  country: string;
  indicator: string;
  rows: NormalizedObservation[];
  lastUpdated: string;
}

export interface ApiErrorPayload {
  error: true;
  code: string;
  message: string;
  details?: string;
}

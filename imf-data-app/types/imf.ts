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

export interface MetadataResponsePayload {
  countries: SelectOption[];
  indicators: IndicatorOption[];
  lastUpdated: string;
}

export interface SeriesResponsePayload {
  country: string;
  countryLabel: string;
  indicator: string;
  indicatorLabel: string;
  data: NormalizedObservation[];
  usedFallback: boolean;
  message?: string | null;
  lastUpdated: string;
}

export interface ApiErrorPayload {
  error: true;
  code: string;
  message: string;
  details?: string;
}

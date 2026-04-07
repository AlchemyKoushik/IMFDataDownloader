export interface ImfObservationRaw {
  "@TIME_PERIOD"?: string;
  "@OBS_VALUE"?: string;
  TIME_PERIOD?: string;
  OBS_VALUE?: string | number;
}

export interface ImfSeriesRaw {
  Obs?: ImfObservationRaw | ImfObservationRaw[];
}

export interface ImfCompactDataResponse {
  CompactData?: {
    DataSet?: {
      Series?: ImfSeriesRaw | ImfSeriesRaw[] | Record<string, unknown>;
    };
  };
}

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

export type ImfApiResponse = ImfCompactDataResponse | ImfDataMapperResponse;

export interface NormalizedObservation {
  year: string;
  value: number;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: string;
  };
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

export interface MetadataResponsePayload {
  countries: SelectOption[];
  indicators: IndicatorOption[];
  lastUpdated: string;
}

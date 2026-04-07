import {
  ImfApiResponse,
  ImfCompactDataResponse,
  ImfDataMapperResponse,
  ImfObservationRaw,
  ImfSeriesRaw,
  NormalizedObservation,
} from "@/types/imf";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

type CompactSeriesInput = ImfSeriesRaw | ImfSeriesRaw[] | Record<string, unknown> | undefined;

const extractSeriesList = (series: CompactSeriesInput): ImfSeriesRaw[] => {
  if (!series) {
    return [];
  }

  if (Array.isArray(series)) {
    return series.filter(isRecord) as ImfSeriesRaw[];
  }

  if (isRecord(series) && "Obs" in series) {
    return [series as ImfSeriesRaw];
  }

  if (isRecord(series)) {
    return Object.values(series).filter(isRecord) as ImfSeriesRaw[];
  }

  return [];
};

const parseObservation = (observation: ImfObservationRaw): NormalizedObservation | null => {
  const rawYear = observation["@TIME_PERIOD"] ?? observation.TIME_PERIOD;
  const rawValue = observation["@OBS_VALUE"] ?? observation.OBS_VALUE;

  if (!rawYear || rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }

  const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    year: String(rawYear),
    value,
  };
};

const comparePeriod = (left: string, right: string): number => {
  const leftNumeric = Number(left);
  const rightNumeric = Number(right);

  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
    return leftNumeric - rightNumeric;
  }

  return left.localeCompare(right);
};

export function parseImfData(response: ImfApiResponse): NormalizedObservation[] {
  if ("values" in response && isRecord(response.values)) {
    const normalizedRows = new Map<string, number>();

    for (const indicatorValues of Object.values((response as ImfDataMapperResponse).values ?? {})) {
      if (!isRecord(indicatorValues)) {
        continue;
      }

      for (const countryValues of Object.values(indicatorValues)) {
        if (!isRecord(countryValues)) {
          continue;
        }

        for (const [period, rawValue] of Object.entries(countryValues)) {
          if (rawValue === null || rawValue === "") {
            continue;
          }

          const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
          if (!Number.isFinite(value)) {
            continue;
          }

          normalizedRows.set(period, value);
        }
      }
    }

    return Array.from(normalizedRows.entries())
      .map(([year, value]) => ({
        year,
        value,
      }))
      .sort((left, right) => comparePeriod(left.year, right.year));
  }

  const series = (response as ImfCompactDataResponse).CompactData?.DataSet?.Series;
  if (!series) {
    return [];
  }

  const normalizedRows = new Map<string, number>();

  for (const seriesItem of extractSeriesList(series)) {
    const observations = toArray(seriesItem.Obs);

    for (const rawObservation of observations) {
      if (!isRecord(rawObservation)) {
        continue;
      }

      const parsed = parseObservation(rawObservation as ImfObservationRaw);
      if (!parsed) {
        continue;
      }

      normalizedRows.set(parsed.year, parsed.value);
    }
  }

  return Array.from(normalizedRows.entries())
    .map(([year, value]) => ({
      year,
      value,
    }))
    .sort((left, right) => comparePeriod(left.year, right.year));
}

import { ImfDataMapperResponse, NormalizedObservation } from "@/types/imf";

const comparePeriod = (left: string, right: string): number => {
  const leftNumeric = Number(left);
  const rightNumeric = Number(right);

  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
    return leftNumeric - rightNumeric;
  }

  return left.localeCompare(right);
};

export function parseImfData(response: ImfDataMapperResponse): NormalizedObservation[] {
  if (!response.values || typeof response.values !== "object") {
    return [];
  }

  const normalizedRows = new Map<string, number>();

  for (const indicatorValues of Object.values(response.values)) {
    if (!indicatorValues || typeof indicatorValues !== "object") {
      continue;
    }

    for (const countryValues of Object.values(indicatorValues)) {
      if (!countryValues || typeof countryValues !== "object") {
        continue;
      }

      for (const [period, rawValue] of Object.entries(countryValues)) {
        if (rawValue === null || rawValue === "") {
          continue;
        }

        const value = typeof rawValue === "number" ? rawValue : Number.parseFloat(rawValue);
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

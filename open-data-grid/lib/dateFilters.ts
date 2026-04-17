import type { AvailableYearRangePayload, DateFilterRequestPayload, DateFilterState } from "@/types/dateFilter";

type YearRangeLike = Pick<AvailableYearRangePayload, "endYear" | "startYear">;

export const MIN_SELECTABLE_YEAR = 1900;

export const getCurrentYear = (): number => new Date().getFullYear();

export const getYearOptions = (minYear = MIN_SELECTABLE_YEAR, maxYear = getCurrentYear()): number[] =>
  Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index);

export const createInitialDateFilter = (): DateFilterState => {
  const currentYear = getCurrentYear();
  return {
    endYear: currentYear,
    startYear: currentYear,
  };
};

export const createDateFilterFromRange = (range: YearRangeLike): DateFilterState => ({
  endYear: range.endYear,
  startYear: range.startYear,
});

export const clampDateFilterToRange = (value: DateFilterState, range: YearRangeLike): DateFilterState => {
  const startYear = Math.min(Math.max(value.startYear, range.startYear), range.endYear);
  const endYear = Math.max(startYear, Math.min(Math.max(value.endYear, range.startYear), range.endYear));

  return {
    endYear,
    startYear,
  };
};

export const syncDateFilterWithAvailableRange = (
  value: DateFilterState,
  previousRange: YearRangeLike | null,
  nextRange: YearRangeLike,
): DateFilterState => {
  if (!previousRange) {
    return createDateFilterFromRange(nextRange);
  }

  const wasUsingFullPreviousRange =
    value.startYear === previousRange.startYear && value.endYear === previousRange.endYear;

  if (wasUsingFullPreviousRange) {
    return createDateFilterFromRange(nextRange);
  }

  return clampDateFilterToRange(value, nextRange);
};

export const isDateFilterValid = (value: DateFilterState): boolean => value.startYear <= value.endYear;

export const toDateFilterPayload = (value: DateFilterState): DateFilterRequestPayload => ({
  end_year: value.endYear,
  start_year: value.startYear,
});

export const getDateFilterSummary = (value: DateFilterState): string => `${value.startYear} to ${value.endYear}`;

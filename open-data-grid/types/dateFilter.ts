export interface DateFilterState {
  endYear: number;
  startYear: number;
}

export interface DateFilterRequestPayload {
  end_year: number;
  start_year: number;
}

export interface AvailableYearRangePayload {
  endYear: number;
  lastUpdated: string;
  startYear: number;
}

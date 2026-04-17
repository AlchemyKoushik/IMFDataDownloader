import type { DateFilterRequestPayload } from "@/types/dateFilter";

export interface FredSearchResult {
  frequency: string;
  id: string;
  title: string;
}

export interface FredSeriesRow {
  date: string;
  seriesId: string;
  title: string;
  value: number | null;
}

export interface FredDataResponsePayload {
  lastUpdated: string;
  rows: FredSeriesRow[];
  totalRows: number;
  warnings: string[];
}

export interface FredDataRequestPayload extends DateFilterRequestPayload {
  series_ids: string[];
}

export interface FredSelectionPayload {
  series_ids: string[];
}

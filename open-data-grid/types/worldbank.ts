import type { SelectOption } from "@/types/imf";

export interface WorldBankMetadataResponsePayload {
  countries: SelectOption[];
  indicators: SelectOption[];
  lastUpdated: string;
}

export interface WorldBankRow {
  country: string;
  indicator: string;
  year: number;
  value: number;
}

export interface WorldBankDataResponsePayload {
  rows: WorldBankRow[];
  totalRows: number;
  warnings: string[];
  lastUpdated: string;
}

export interface WorldBankDataRequestPayload {
  countries: string[];
  indicators: string[];
  latestYears?: number;
  startYear?: number;
  endYear?: number;
}

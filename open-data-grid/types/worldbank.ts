import type { DateFilterRequestPayload } from "@/types/dateFilter";
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
  value: number | null;
}

export interface WorldBankDataResponsePayload {
  rows: WorldBankRow[];
  totalRows: number;
  warnings: string[];
  lastUpdated: string;
}

export interface WorldBankDataRequestPayload extends DateFilterRequestPayload {
  countries: string[];
  indicators: string[];
}

export interface WorldBankSelectionPayload {
  countries: string[];
  indicators: string[];
}

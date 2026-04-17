"use client";

import { getDateFilterSummary, getYearOptions } from "@/lib/dateFilters";
import type { DateFilterState } from "@/types/dateFilter";
import { SelectDropdown } from "@/components/ui/SelectDropdown";
import type { SelectOption } from "@/types/imf";

interface DateToggleProps {
  disabled?: boolean;
  helperText?: string;
  isLoading?: boolean;
  label?: string;
  maxYear?: number | null;
  minYear?: number | null;
  onChange: (value: DateFilterState) => void;
  value: DateFilterState;
}

export function DateToggle({
  disabled = false,
  helperText = "Select a country and indicator combination to load the available years. Blank years inside the selected span stay blank in the export.",
  isLoading = false,
  label = "Year Range",
  maxYear = null,
  minYear = null,
  onChange,
  value,
}: DateToggleProps) {
  const hasAvailableRange =
    typeof minYear === "number" &&
    typeof maxYear === "number" &&
    Number.isFinite(minYear) &&
    Number.isFinite(maxYear) &&
    minYear <= maxYear;
  const yearOptions = hasAvailableRange ? getYearOptions(minYear, maxYear) : [];
  const selectOptions: SelectOption[] = yearOptions.map((year) => ({
    label: `${year}`,
    value: `${year}`,
  }));
  const isSelectDisabled = disabled || isLoading || !hasAvailableRange;
  const statusLabel = isLoading
    ? "Loading years..."
    : hasAvailableRange
      ? getDateFilterSummary(value)
      : "Select filters";
  const rangeLabel = isLoading
    ? "Checking coverage"
    : hasAvailableRange
      ? `Available ${minYear} to ${maxYear}`
      : "No range loaded";

  const handleStartYearChange = (nextStartYear: number): void => {
    onChange({
      endYear: Math.max(value.endYear, nextStartYear),
      startYear: nextStartYear,
    });
  };

  const handleEndYearChange = (nextEndYear: number): void => {
    onChange({
      endYear: nextEndYear,
      startYear: Math.min(value.startYear, nextEndYear),
    });
  };

  return (
    <div className="fieldGroup">
      <div className="fieldHeading">
        <span className="fieldLabel">{label}</span>
        <span className="resultBadge">{statusLabel}</span>
      </div>

      <div className={`dateToggle${isSelectDisabled ? " dateToggle-disabled" : ""}`}>
        <div className="dropdownMetaRow">
          <span className="searchHint">
            {hasAvailableRange ? "Years follow the current selection." : "Selection-aware range"}
          </span>
          <span className="searchHintBadge">{rangeLabel}</span>
        </div>

        <div className="dateCustomGrid">
          <SelectDropdown
            disabled={isSelectDisabled}
            emptyMessage="No years available yet."
            helperText="Select start year"
            id="date-range-start-year"
            label="Start Year"
            options={selectOptions}
            placeholder="Select filters first"
            selectedValue={hasAvailableRange ? `${value.startYear}` : ""}
            showMeta={false}
            onChange={(nextValue) => handleStartYearChange(Number(nextValue))}
          />

          <SelectDropdown
            disabled={isSelectDisabled}
            emptyMessage="No years available yet."
            helperText="Select end year"
            id="date-range-end-year"
            label="End Year"
            options={selectOptions}
            placeholder="Select filters first"
            selectedValue={hasAvailableRange ? `${value.endYear}` : ""}
            showMeta={false}
            onChange={(nextValue) => handleEndYearChange(Number(nextValue))}
          />
        </div>

        <p className="dateToggleHint">{helperText}</p>
      </div>
    </div>
  );
}

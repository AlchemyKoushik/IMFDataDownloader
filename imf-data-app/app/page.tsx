"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { useAppReady } from "@/components/AppReadyProvider";
import { REGION_SPECIFIC_DATASET_HINT, isIndicatorAvailableForCountry } from "@/lib/datasetValidation";
import { generateExcel } from "@/lib/excelGenerator";
import { fetchSafeSeriesData, ImfClientError } from "@/lib/imfClient";
import { IndicatorOption, SelectOption } from "@/types/imf";

type NoticeTone = "idle" | "success" | "error" | "empty";

interface SearchableSelectorProps<T extends SelectOption> {
  disabled?: boolean;
  emptyMessage: string;
  extraText?: (option: T) => string;
  helperText: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: T[];
  placeholder: string;
  query: string;
  selectedValue: string;
  setQuery: (value: string) => void;
}

const MAX_VISIBLE_RESULTS = 120;
const PAGE_STEP = 8;
const SEARCH_DEBOUNCE_MS = 300;

const useDebouncedValue = (value: string, delayMs: number): string => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [delayMs, value]);

  return debouncedValue;
};

const defaultOptionValue = (options: SelectOption[], preferredValue: string): string =>
  options.find((option) => option.value === preferredValue)?.value ?? options[0]?.value ?? "";

const filterOptions = <T extends SelectOption>(
  options: T[],
  query: string,
  selectedValue: string,
  extraText?: (option: T) => string,
): T[] => {
  const normalizedQuery = query.trim().toLowerCase();

  let filtered = options;

  if (normalizedQuery) {
    const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);

    filtered = options.filter((option) => {
      const searchText = `${option.label} ${option.value} ${extraText ? extraText(option) : ""}`.toLowerCase();
      return queryParts.every((part) => searchText.includes(part));
    });
  }

  if (!normalizedQuery) {
    const selectedOption = options.find((option) => option.value === selectedValue);
    const remaining = filtered.filter((option) => option.value !== selectedValue).slice(0, MAX_VISIBLE_RESULTS - 1);

    if (selectedOption) {
      return [selectedOption, ...remaining];
    }
  }

  return filtered.slice(0, MAX_VISIBLE_RESULTS);
};

function SearchableSelector<T extends SelectOption>({
  disabled = false,
  emptyMessage,
  extraText,
  helperText,
  id,
  label,
  onChange,
  options,
  placeholder,
  query,
  selectedValue,
  setQuery,
}: SearchableSelectorProps<T>) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shouldAutoScrollRef = useRef(false);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const filteredOptions = filterOptions(options, debouncedQuery, selectedValue, extraText);
  const selectedOption = options.find((option) => option.value === selectedValue) ?? null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        if (selectedOption) {
          setQuery(selectedOption.label);
        }
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [selectedOption, setQuery]);

  useEffect(() => {
    if (!isOpen && selectedOption && query !== selectedOption.label) {
      setQuery(selectedOption.label);
    }
  }, [isOpen, query, selectedOption, setQuery]);

  useEffect(() => {
    const nextIndex = filteredOptions.findIndex((option) => option.value === selectedValue);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [debouncedQuery, filteredOptions, isOpen, selectedValue]);

  useEffect(() => {
    const activeOption = optionRefs.current[activeIndex];
    if (isOpen && activeOption && shouldAutoScrollRef.current) {
      activeOption.scrollIntoView({
        block: "nearest",
      });
      shouldAutoScrollRef.current = false;
    }
  }, [activeIndex, isOpen]);

  const handleSelect = (option: T): void => {
    onChange(option.value);
    setActiveIndex(filteredOptions.findIndex((entry) => entry.value === option.value));
    setQuery(option.label);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const moveIndex = (nextIndex: number): void => {
    const maxIndex = Math.max(filteredOptions.length - 1, 0);
    setActiveIndex(Math.min(Math.max(nextIndex, 0), maxIndex));
  };

  const moveIndexFromKeyboard = (nextIndex: number): void => {
    shouldAutoScrollRef.current = true;
    moveIndex(nextIndex);
  };

  const openDropdown = (): void => {
    if (!disabled) {
      setIsOpen(true);
    }
  };

  const closeDropdown = (): void => {
    setIsOpen(false);
    if (selectedOption) {
      setQuery(selectedOption.label);
    }
  };

  const handleToggle = (): void => {
    if (disabled) {
      return;
    }

    setIsOpen((current) => !current);
    inputRef.current?.focus();
  };

  return (
    <div className="fieldGroup">
      <div className="fieldHeading">
        <label className="fieldLabel" htmlFor={id}>
          {label}
        </label>
        <span className="resultBadge">{filteredOptions.length} shown</span>
      </div>

      <div className="dropdownWrap" ref={wrapperRef}>
        <div className={`dropdownShell${isOpen ? " dropdownShell-open" : ""}${disabled ? " dropdownShell-disabled" : ""}`}>
          <span className="dropdownIcon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <circle cx="8.5" cy="8.5" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="m12.5 12.5 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            </svg>
          </span>

          <input
            ref={inputRef}
            id={id}
            className="dropdownInput"
            disabled={disabled}
            placeholder={placeholder}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              openDropdown();
            }}
            onClick={openDropdown}
            onFocus={(event) => {
              openDropdown();
              event.currentTarget.select();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeDropdown();
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex + 1);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex - 1);
                return;
              }

              if (event.key === "PageDown") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex + PAGE_STEP);
                return;
              }

              if (event.key === "PageUp") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex - PAGE_STEP);
                return;
              }

              if (event.key === "Home") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(0);
                return;
              }

              if (event.key === "End") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(filteredOptions.length - 1);
                return;
              }

              if (event.key === "Enter" && filteredOptions.length) {
                event.preventDefault();
                handleSelect(filteredOptions[activeIndex] ?? filteredOptions[0]);
              }
            }}
          />

          <button
            aria-label={`Toggle ${label.toLowerCase()} results`}
            className="dropdownToggle"
            disabled={disabled}
            type="button"
            onClick={handleToggle}
          >
            <svg
              aria-hidden="true"
              className={`dropdownChevron${isOpen ? " dropdownChevron-open" : ""}`}
              viewBox="0 0 20 20"
            >
              <path d="M5.25 7.5 10 12.25 14.75 7.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        </div>

        {isOpen ? (
          <div className="dropdownPopover">
            <div className="dropdownMetaRow">
              <span className="searchHint">{helperText}</span>
              <span className="searchHintBadge">{filteredOptions.length} matches</span>
            </div>

            <div className="resultList" role="listbox" aria-label={label}>
              {filteredOptions.length ? (
                filteredOptions.map((option, index) => {
                  const isSelected = option.value === selectedValue;
                  const isActive = index === activeIndex;
                  const metaText = extraText ? extraText(option).replace(/\s+/g, " ").trim() : "";

                  return (
                    <button
                      key={option.value}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      className={`resultOption${isSelected ? " resultOption-selected" : ""}${
                        isActive ? " resultOption-active" : ""
                      }`}
                      role="option"
                      type="button"
                      onMouseEnter={() => moveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelect(option)}
                    >
                      <span className={`resultIndex${isSelected ? " resultIndex-selected" : ""}`}>{index + 1}</span>

                      <span className="resultContent">
                        <span className="resultTitle">{option.label}</span>
                        <span className="resultMeta">{metaText ? `${option.value} | ${metaText}` : option.value}</span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="comboEmpty">{emptyMessage}</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="selectionPreview" aria-live="polite">
        {selectedOption ? (
          <>
            <strong>{selectedOption.label}</strong>
            <span>{selectedOption.value}</span>
          </>
        ) : (
          <span>No selection yet.</span>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { metadata } = useAppReady();
  const [country, setCountry] = useState("");
  const [indicator, setIndicator] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [indicatorQuery, setIndicatorQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("idle");
  const [noticeMessage, setNoticeMessage] = useState("Metadata ready. Choose a country, then generate an Excel export.");

  const countries = metadata?.countries ?? [];
  const indicators = metadata?.indicators ?? [];
  const countryCompatibleIndicators = indicators.filter((option) => isIndicatorAvailableForCountry(country, option));

  useEffect(() => {
    if (!countries.length) {
      return;
    }

    const selectedCountry = countries.find((option) => option.value === country) ?? null;
    if (selectedCountry) {
      setCountryQuery((current) => current || selectedCountry.label);

      return;
    }

    const nextCountry = defaultOptionValue(countries, "USA");
    const nextCountryLabel = countries.find((option) => option.value === nextCountry)?.label ?? "";

    setCountry(nextCountry);
    if (nextCountryLabel) {
      setCountryQuery(nextCountryLabel);
    }
  }, [countries, country]);

  useEffect(() => {
    if (!countryCompatibleIndicators.length) {
      return;
    }

    const selectedIndicator = countryCompatibleIndicators.find((option) => option.value === indicator) ?? null;
    if (selectedIndicator) {
      setIndicatorQuery((current) => current || selectedIndicator.label);

      return;
    }

    const previousIndicator = indicators.find((option) => option.value === indicator) ?? null;
    const nextIndicator = defaultOptionValue(countryCompatibleIndicators, "NGDP_RPCH");
    const nextIndicatorLabel = countryCompatibleIndicators.find((option) => option.value === nextIndicator)?.label ?? "";

    setIndicator(nextIndicator);
    if (nextIndicatorLabel) {
      setIndicatorQuery(nextIndicatorLabel);
    }

    if (previousIndicator) {
      setNoticeTone("idle");
      setNoticeMessage("Some datasets are region-specific. The indicator list was updated for the selected country.");
    }
  }, [countryCompatibleIndicators, indicator, indicators]);

  useEffect(() => {
    if (!metadata) {
      return;
    }

    setNoticeTone("idle");
    setNoticeMessage(`Metadata ready: ${metadata.countries.length} countries/regions and ${metadata.indicators.length} indicators loaded.`);
  }, [metadata]);

  const selectedCountry = countries.find((option) => option.value === country) ?? null;
  const selectedIndicator = countryCompatibleIndicators.find((option) => option.value === indicator) ?? null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!country || !indicator || !selectedCountry || !selectedIndicator) {
      setNoticeTone("error");
      setNoticeMessage("Please choose both a country/region and an indicator.");
      return;
    }

    setIsLoading(true);
    setNoticeTone("idle");
    setNoticeMessage("Fetching IMF data...");

    try {
      const result = await fetchSafeSeriesData(selectedCountry.value, selectedIndicator, indicators);
      if (!result.payload.rows.length) {
        setNoticeTone("empty");
        setNoticeMessage("No data available for this selection.");
        return;
      }

      setNoticeMessage(result.usedFallback ? "Generating Excel from WEO fallback..." : "Generating Excel...");

      await new Promise<void>((resolve, reject) => {
        window.setTimeout(() => {
          try {
            generateExcel(result.payload.rows, selectedCountry.label, result.resolvedIndicator.label);
            resolve();
          } catch (error) {
            reject(error);
          }
        }, 0);
      });

      setNoticeTone("success");
      setNoticeMessage(
        result.usedFallback
          ? `Downloaded ${result.payload.rows.length} IMF observations successfully. No data was available for the selected dataset, so the WEO fallback was used.`
          : `Downloaded ${result.payload.rows.length} IMF observations successfully.`,
      );
    } catch (error) {
      if (error instanceof ImfClientError) {
        if (error.code === "NO_DATA" || error.code === "NO_DATA_AFTER_FALLBACK") {
          setNoticeTone("empty");
          setNoticeMessage(error.message);
        } else if (error.code === "INVALID_DATASET_COUNTRY") {
          setNoticeTone("error");
          setNoticeMessage("This dataset is not available for the selected country, and no WEO fallback exists for this indicator.");
        } else {
          setNoticeTone("error");
          setNoticeMessage(error.message);
        }
      } else {
        setNoticeTone("error");
        setNoticeMessage("Failed to generate Excel file.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="pageShell">
      <section className="heroPanel">
        <div className="heroCopy">
          <span className="eyebrow">Production-ready IMF downloader</span>
          <h1>IMF World Economic Outlook Data.</h1>
          <p>
            Search the live IMF catalog, fetch time-series data through resilient public proxy connectors, and
            generate a clean Excel export directly in the browser.
          </p>

          <div className="statsRow" aria-label="Catalog statistics">
            <div className="statCard">
              <strong>{metadata?.countries.length ?? "..."}</strong>
              <span>Countries / regions</span>
            </div>
            <div className="statCard">
              <strong>{metadata?.indicators.length ?? "..."}</strong>
              <span>Indicators</span>
            </div>
          </div>
        </div>

        <form className="downloadCard" onSubmit={handleSubmit}>
          <div className="catalogNote">
            <strong>Live IMF catalog</strong>
            <span>
              Type to search, use arrow keys to move, and press Enter to select. {REGION_SPECIFIC_DATASET_HINT}
            </span>
          </div>

          <SearchableSelector
            disabled={isLoading}
            emptyMessage="No country or region matched that search."
            helperText="Search by country name or ISO code. Results are debounced and keyboard-friendly."
            id="country-search"
            label="Country / Region"
            options={countries}
            placeholder="Search country or ISO code..."
            query={countryQuery}
            selectedValue={country}
            setQuery={setCountryQuery}
            onChange={setCountry}
          />

          <SearchableSelector
            disabled={isLoading}
            emptyMessage="No compatible indicator matched that search."
            extraText={(option: IndicatorOption) =>
              [option.unit, option.dataset, option.source].filter(Boolean).join(" | ")
            }
            helperText="Search by name, code, unit, dataset, or source. Region-specific datasets are filtered by country."
            id="indicator-search"
            label="Indicator"
            options={countryCompatibleIndicators}
            placeholder="Search indicator, code, or unit..."
            query={indicatorQuery}
            selectedValue={indicator}
            setQuery={setIndicatorQuery}
            onChange={setIndicator}
          />

          <div className="selectionPreview detailPreview" aria-live="polite">
            {selectedCountry ? (
              <>
                <strong>{selectedCountry.label}</strong>
                <span>{selectedCountry.value}</span>
              </>
            ) : null}
            {selectedIndicator ? (
              <>
                <strong>{selectedIndicator.label}</strong>
                <span>{selectedIndicator.value}</span>
                {selectedIndicator.unit ? <small>Unit: {selectedIndicator.unit}</small> : null}
                {selectedIndicator.dataset ? <small>Dataset: {selectedIndicator.dataset}</small> : null}
                {selectedIndicator.source ? <small>Source: {selectedIndicator.source}</small> : null}
              </>
            ) : null}
            {!selectedCountry && !selectedIndicator ? <span>No selection yet.</span> : null}
          </div>

          <button
            className="downloadButton"
            type="submit"
            disabled={isLoading || !country || !indicator || !selectedCountry || !selectedIndicator}
          >
            {isLoading ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Generating Excel...
              </>
            ) : (
              "Download Excel"
            )}
          </button>

          <div className={`notice notice-${noticeTone}`} role="status" aria-live="polite">
            {noticeMessage}
          </div>
        </form>
      </section>
    </main>
  );
}

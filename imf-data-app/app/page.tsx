"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { fetchMetadata, fetchSeriesData, ImfClientError } from "@/lib/imfClient";
import { ApiErrorPayload, DownloadObservation, IndicatorOption, MetadataResponsePayload, SelectOption } from "@/types/imf";

type NoticeTone = "idle" | "success" | "error" | "empty";

class ApiRequestError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

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

const FRONTEND_TIMEOUT_MS = 20_000;
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

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FRONTEND_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

const readApiError = async (response: Response, fallbackMessage: string, fallbackCode: string): Promise<ApiRequestError> => {
  let message = fallbackMessage;
  let code = fallbackCode;

  try {
    const payload = (await response.json()) as ApiErrorPayload;
    message = payload.message ?? message;
    code = payload.code ?? code;
  } catch {
    // Ignore malformed error payloads and keep the fallback message.
  }

  return new ApiRequestError(message, response.status, code);
};

const requestWorkbook = async (rows: DownloadObservation[]): Promise<Blob> => {
  const response = await fetchWithTimeout("/api/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw await readApiError(response, "Unable to generate the Excel file.", "DOWNLOAD_FAILED");
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new ApiRequestError("The generated Excel file was empty.", 500, "EMPTY_FILE");
  }

  return blob;
};

const triggerBlobDownload = (blob: Blob): void => {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "IMF_Data.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
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
  const [metadata, setMetadata] = useState<MetadataResponsePayload | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(true);
  const [country, setCountry] = useState("");
  const [indicator, setIndicator] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [indicatorQuery, setIndicatorQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("idle");
  const [noticeMessage, setNoticeMessage] = useState("Loading the IMF catalog...");

  useEffect(() => {
    let isMounted = true;

    const hydrateMetadata = async (): Promise<void> => {
      try {
        const payload = await fetchMetadata();
        if (!isMounted) {
          return;
        }

        const nextCountry = defaultOptionValue(payload.countries, "USA");
        const nextIndicator = defaultOptionValue(payload.indicators, "NGDP_RPCH");

        setMetadata(payload);
        setCountry(nextCountry);
        setIndicator(nextIndicator);
        setCountryQuery(payload.countries.find((option) => option.value === nextCountry)?.label ?? "");
        setIndicatorQuery(payload.indicators.find((option) => option.value === nextIndicator)?.label ?? "");
        setNoticeTone("idle");
        setNoticeMessage(
          `Loaded ${payload.countries.length} countries/regions and ${payload.indicators.length} indicators from the IMF catalog.`,
        );
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (error instanceof ImfClientError) {
          setMetadataError(error.message);
          setNoticeTone("error");
          setNoticeMessage(error.message);
        } else {
          setMetadataError("Unable to load the IMF catalog right now.");
          setNoticeTone("error");
          setNoticeMessage("Unable to load the IMF catalog right now.");
        }
      } finally {
        if (isMounted) {
          setIsMetadataLoading(false);
        }
      }
    };

    void hydrateMetadata();

    return () => {
      isMounted = false;
    };
  }, []);

  const countries = metadata?.countries ?? [];
  const indicators = metadata?.indicators ?? [];

  const selectedCountry = countries.find((option) => option.value === country) ?? null;
  const selectedIndicator = indicators.find((option) => option.value === indicator) ?? null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!selectedCountry || !selectedIndicator) {
      setNoticeTone("error");
      setNoticeMessage("Please choose both a country/region and an indicator.");
      return;
    }

    setIsLoading(true);
    setNoticeTone("idle");
    setNoticeMessage("Fetching IMF data...");

    try {
      const payload = await fetchSeriesData(selectedCountry.value, selectedIndicator.value);
      const rows: DownloadObservation[] = payload.rows.map((row) => ({
        ...row,
        country: payload.country,
        indicator: payload.indicator,
      }));

      setNoticeMessage("Generating Excel file...");

      const workbook = await requestWorkbook(rows);
      triggerBlobDownload(workbook);

      setNoticeTone("success");
      setNoticeMessage(`Downloaded ${rows.length} IMF observations successfully.`);
    } catch (error) {
      if (error instanceof ImfClientError) {
        if (error.code === "NO_DATA") {
          setNoticeTone("empty");
          setNoticeMessage("No data available for this dataset.");
        } else {
          setNoticeTone("error");
          setNoticeMessage(error.message);
        }
      } else if (error instanceof ApiRequestError) {
        setNoticeTone("error");
        setNoticeMessage(error.message);
      } else if (error instanceof Error && error.name === "AbortError") {
        setNoticeTone("error");
        setNoticeMessage("The request took too long. Please try again in a moment.");
      } else {
        setNoticeTone("error");
        setNoticeMessage("Something went wrong while preparing the download.");
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
            Search the cached IMF catalog, fetch time-series data through resilient public proxy connectors, and
            generate a clean Excel export through a Vercel-safe serverless workflow.
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
              {isMetadataLoading
                ? "Loading official metadata..."
                : "Type to search, use arrow keys to move, and press Enter to select."}
            </span>
          </div>

          <SearchableSelector
            disabled={isMetadataLoading || isLoading}
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
            disabled={isMetadataLoading || isLoading}
            emptyMessage="No indicator matched that search."
            extraText={(option: IndicatorOption) =>
              [option.unit, option.dataset, option.source].filter(Boolean).join(" | ")
            }
            helperText="Search by name, code, unit, dataset, or source. Scroll and press Enter to pick."
            id="indicator-search"
            label="Indicator"
            options={indicators}
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
            disabled={isLoading || isMetadataLoading || Boolean(metadataError) || !country || !indicator}
          >
            {isLoading ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Preparing Excel...
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

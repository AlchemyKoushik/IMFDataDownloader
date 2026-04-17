"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { DateToggle } from "@/components/DateToggle";
import { ExplorerPageShell } from "@/components/layout/ExplorerPageShell";
import { ActionButton } from "@/components/ui/ActionButton";
import { SelectionSummaryCard } from "@/components/ui/SelectionSummaryCard";
import { type NoticeTone, StatusNotice } from "@/components/ui/StatusNotice";
import { BackendClientError } from "@/lib/backendClient";
import { createInitialDateFilter, getDateFilterSummary, syncDateFilterWithAvailableRange, toDateFilterPayload } from "@/lib/dateFilters";
import { downloadFredExcel, fetchFredData, fetchFredSeriesRange, searchFredSeries } from "@/lib/fredClient";
import { buildDownloadSuccessMessage, getFriendlyErrorMessage } from "@/lib/noticeMessages";
import type { AvailableYearRangePayload } from "@/types/dateFilter";
import type { FredSearchResult } from "@/types/fred";

const SOURCE_LABEL = "FRED";
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

const joinSeriesLabels = (series: FredSearchResult[], limit = 2): string =>
  series
    .slice(0, limit)
    .map((entry) => entry.title)
    .join(", ");

export function FredExplorer() {
  const [dateFilter, setDateFilter] = useState(() => createInitialDateFilter());
  const [availableRange, setAvailableRange] = useState<AvailableYearRangePayload | null>(null);
  const [isRangeLoading, setIsRangeLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("idle");
  const [noticeMessage, setNoticeMessage] = useState(
    "Search for FRED series, select one or more matches, choose a year range, and download Excel.",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FredSearchResult[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<FredSearchResult[]>([]);
  const availableRangeRef = useRef<AvailableYearRangePayload | null>(null);

  const selectedSeriesIdSet = new Set(selectedSeries.map((series) => series.id));

  useEffect(() => {
    const normalizedQuery = searchQuery.trim();

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);

      try {
        const results = await searchFredSeries(normalizedQuery, controller.signal);
        if (isCancelled) {
          return;
        }

        setSearchResults(results);
        setNoticeTone(results.length ? "idle" : "empty");
        setNoticeMessage(
          results.length
            ? `Found ${results.length} FRED series for "${normalizedQuery}".`
            : `No FRED series matched "${normalizedQuery}".`,
        );
      } catch (error) {
        if (isCancelled || controller.signal.aborted) {
          return;
        }

        if (error instanceof BackendClientError) {
          setNoticeTone("error");
          setNoticeMessage(getFriendlyErrorMessage(SOURCE_LABEL, error.code, error.message));
        } else {
          setNoticeTone("error");
          setNoticeMessage("We couldn't search FRED right now. Please try again.");
        }
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!selectedSeries.length) {
      availableRangeRef.current = null;
      setAvailableRange(null);
      setIsRangeLoading(false);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    setIsRangeLoading(true);

    void fetchFredSeriesRange(
      {
        series_ids: selectedSeries.map((series) => series.id),
      },
      controller.signal,
    )
      .then((nextRange) => {
        if (isCancelled || controller.signal.aborted) {
          return;
        }

        const previousRange = availableRangeRef.current;
        availableRangeRef.current = nextRange;
        setAvailableRange(nextRange);
        setDateFilter((current) => syncDateFilterWithAvailableRange(current, previousRange, nextRange));
      })
      .catch((error) => {
        if (isCancelled || controller.signal.aborted) {
          return;
        }

        availableRangeRef.current = null;
        setAvailableRange(null);

        if (error instanceof BackendClientError) {
          setNoticeTone(error.code === "NO_DATA" ? "empty" : "error");
          setNoticeMessage(getFriendlyErrorMessage(SOURCE_LABEL, error.code, error.message));
        } else {
          setNoticeTone("error");
          setNoticeMessage("We couldn't load the available FRED year range. Please try again.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsRangeLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [selectedSeries]);

  const toggleSeries = (series: FredSearchResult): void => {
    setSelectedSeries((current) => {
      if (current.some((entry) => entry.id === series.id)) {
        return current.filter((entry) => entry.id !== series.id);
      }

      return [...current, series];
    });
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setSearchQuery(event.target.value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!selectedSeries.length) {
      setNoticeTone("error");
      setNoticeMessage("Please select at least one FRED series.");
      return;
    }

    if (!availableRange) {
      setNoticeTone("error");
      setNoticeMessage("Please wait for the available year range to finish loading.");
      return;
    }

    const payload = {
      series_ids: selectedSeries.map((series) => series.id),
      ...toDateFilterPayload(dateFilter),
    };

    setIsDownloading(true);
    setNoticeTone("idle");
    setNoticeMessage("Getting your FRED data...");

    try {
      const result = await fetchFredData(payload);
      setNoticeMessage("Creating your FRED Excel file...");
      await downloadFredExcel(payload);

      setNoticeTone("success");
      setNoticeMessage(buildDownloadSuccessMessage({ rowCount: result.rows.length, sourceLabel: SOURCE_LABEL, warnings: result.warnings }));
    } catch (error) {
      if (error instanceof BackendClientError) {
        setNoticeTone(error.code === "NO_DATA" ? "empty" : "error");
        setNoticeMessage(getFriendlyErrorMessage(SOURCE_LABEL, error.code, error.message));
      } else {
        setNoticeTone("error");
        setNoticeMessage("We couldn't create the FRED Excel file. Please try again.");
      }
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <main className="appBootstrap appBootstrapContent">
      <ExplorerPageShell
        description="Search the Federal Reserve Economic Data catalog, assemble a custom basket of series, let the year range follow the selected coverage, and export a single Excel workbook without forcing a country-indicator model."
        stats={[
          { label: "Selected series", value: selectedSeries.length },
          { label: "Range", value: availableRange ? getDateFilterSummary(dateFilter) : "Waiting" },
        ]}
        subheading="powered by Alchemy Research & Analytics"
        title="Open Data Grid"
      >
        <form className="panelForm" onSubmit={handleSubmit}>
          <div className="catalogNote">
            <strong>Live FRED series search</strong>
            <span>
              Search the FRED catalog with debounced queries, select multiple series with checkboxes, and let the year
              range expand to the combined coverage of the selected series.
            </span>
          </div>

          <div className="fieldGroup">
            <div className="fieldHeading">
              <label className="fieldLabel" htmlFor="fred-series-search">
                Search Series
              </label>
              <span className="resultBadge">
                {isSearching ? "Searching..." : searchResults.length ? `${searchResults.length} shown` : "Type to search"}
              </span>
            </div>

            <div className="fredSearchPanel">
              <div className="fredSearchInputWrap">
                <span className="dropdownIcon fredSearchIcon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <circle cx="8.5" cy="8.5" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.7" />
                    <path d="m12.5 12.5 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                  </svg>
                </span>
                <input
                  autoComplete="off"
                  className="fredSearchInput"
                  id="fred-series-search"
                  placeholder="Search for inflation, GDP, unemployment..."
                  spellCheck={false}
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchChange}
                />
              </div>

              <p className="dateToggleHint">
                Start typing to search FRED series titles and IDs. Requests are debounced and cached to avoid duplicate calls.
              </p>

              <div className="fredResultList" aria-live="polite">
                {searchQuery.trim().length < MIN_QUERY_LENGTH ? (
                  <div className="comboEmpty">Type at least 2 characters to search the FRED catalog.</div>
                ) : searchResults.length ? (
                  searchResults.map((series) => {
                    const isSelected = selectedSeriesIdSet.has(series.id);

                    return (
                      <label
                        key={series.id}
                        className={`fredResultCard${isSelected ? " fredResultCard-selected" : ""}`}
                      >
                        <input
                          checked={isSelected}
                          className="fredResultCheckbox"
                          type="checkbox"
                          onChange={() => toggleSeries(series)}
                        />

                        <span className="fredResultBody">
                          <span className="resultTitle">{series.title}</span>
                          <span className="resultMeta">
                            {series.id} | {series.frequency}
                          </span>
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <div className="comboEmpty">
                    {isSearching ? "Searching the FRED catalog..." : "No results for that search yet."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="fieldGroup">
            <div className="fieldHeading">
              <span className="fieldLabel">Selected Series</span>
              <span className="resultBadge">{selectedSeries.length} selected</span>
            </div>

            <div className="fredSelectedPanel" aria-live="polite">
              {selectedSeries.length ? (
                selectedSeries.map((series) => (
                  <button
                    key={series.id}
                    className="fredSelectedChip"
                    type="button"
                    onClick={() => toggleSeries(series)}
                  >
                    <span>{series.title}</span>
                    <small>{series.id}</small>
                  </button>
                ))
              ) : (
                <span className="fredSelectedEmpty">No series selected yet.</span>
              )}
            </div>
          </div>

          <DateToggle
            disabled={isDownloading}
            helperText={
              availableRange
                ? "Available years are based on the selected FRED series. If one series is missing a year inside this span, that cell stays blank in the export."
                : "Select at least one FRED series to load the available years for this selection."
            }
            isLoading={isRangeLoading}
            maxYear={availableRange?.endYear ?? null}
            minYear={availableRange?.startYear ?? null}
            value={dateFilter}
            onChange={setDateFilter}
          />

          <SelectionSummaryCard
            items={[
              selectedSeries.length
                ? {
                    caption:
                      selectedSeries.length > 2
                        ? `${joinSeriesLabels(selectedSeries)} +${selectedSeries.length - 2} more`
                        : joinSeriesLabels(selectedSeries),
                    details: selectedSeries.slice(0, 2).map((series) => `${series.id} frequency: ${series.frequency}`),
                    title: `${selectedSeries.length} FRED series selected`,
                  }
                : { title: "" },
              {
                caption: availableRange
                  ? `Available ${availableRange.startYear} to ${availableRange.endYear}. Missing years inside your selected span stay blank in the export.`
                  : selectedSeries.length
                    ? "Loading the available years for this selection."
                    : "Select at least one FRED series to load the available years.",
                title: availableRange ? `Range: ${getDateFilterSummary(dateFilter)}` : "Range: Waiting for selection",
              },
            ]}
          />

          <ActionButton
            disabled={!selectedSeries.length || !availableRange || isRangeLoading}
            isLoading={isDownloading}
            loadingLabel="Preparing Download..."
            type="submit"
          >
            Download Excel
          </ActionButton>

          <StatusNotice message={noticeMessage} tone={noticeTone} />
        </form>
      </ExplorerPageShell>
    </main>
  );
}

"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { DateToggle } from "@/components/DateToggle";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ExplorerPageShell } from "@/components/layout/ExplorerPageShell";
import { ActionButton } from "@/components/ui/ActionButton";
import { SearchableDropdown } from "@/components/ui/SearchableDropdown";
import { SelectionSummaryCard } from "@/components/ui/SelectionSummaryCard";
import { type NoticeTone, StatusNotice } from "@/components/ui/StatusNotice";
import { useCatalogBootstrap } from "@/hooks/useCatalogBootstrap";
import {
  BackendClientError,
  downloadBulkSeriesExcel,
  fetchBulkSeriesData,
  fetchBulkSeriesRange,
  fetchMetadata,
  getApiBaseUrl,
  primeMetadataCache,
} from "@/lib/backendClient";
import { createInitialDateFilter, getDateFilterSummary, syncDateFilterWithAvailableRange, toDateFilterPayload } from "@/lib/dateFilters";
import { REGION_SPECIFIC_DATASET_HINT, isIndicatorAvailableForAnyCountry } from "@/lib/datasetValidation";
import {
  buildDownloadSuccessMessage,
  getExplorerNoticeMessages,
  getFriendlyErrorMessage,
  getLoadingScreenMessages,
} from "@/lib/noticeMessages";
import type { AvailableYearRangePayload } from "@/types/dateFilter";
import type { IndicatorOption, MetadataResponsePayload, SelectOption } from "@/types/imf";

const MIN_COUNTRY_COUNT = 200;
const MIN_INDICATOR_COUNT = 100;
const SOURCE_LABEL = "IMF";
const EXPLORER_MESSAGES = getExplorerNoticeMessages(SOURCE_LABEL);
const LOADING_MESSAGES = getLoadingScreenMessages(SOURCE_LABEL);

const joinLabels = (options: SelectOption[], limit = 3): string =>
  options
    .slice(0, limit)
    .map((option) => option.label)
    .join(", ");

export function ImfExplorer() {
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>([]);
  const [countryQuery, setCountryQuery] = useState("");
  const [indicatorQuery, setIndicatorQuery] = useState("");
  const [dateFilter, setDateFilter] = useState(() => createInitialDateFilter());
  const [availableRange, setAvailableRange] = useState<AvailableYearRangePayload | null>(null);
  const [isRangeLoading, setIsRangeLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("idle");
  const [noticeMessage, setNoticeMessage] = useState(EXPLORER_MESSAGES.initial);
  const availableRangeRef = useRef<AvailableYearRangePayload | null>(null);

  const {
    canRetryManually,
    data: metadata,
    hasError,
    isAppReady,
    isLoadingScreenVisible,
    loadingStatus,
    maxRetries,
    retry,
    retryAttempt,
  } = useCatalogBootstrap<MetadataResponsePayload>({
    getFallbackErrorMessage: () => EXPLORER_MESSAGES.metadataError(getApiBaseUrl()),
    load: async () => {
      const nextMetadata = await fetchMetadata();
      primeMetadataCache(nextMetadata);
      return nextMetadata;
    },
    successMessage: (payload) => EXPLORER_MESSAGES.metadataLoadedStatus(payload.countries.length, payload.indicators.length),
    validate: (payload) => {
      if (payload.countries.length < MIN_COUNTRY_COUNT || payload.indicators.length < MIN_INDICATOR_COUNT) {
        throw new Error("Incomplete IMF metadata received.");
      }
    },
  });

  const countries = metadata?.countries ?? [];
  const indicators = metadata?.indicators ?? [];
  const countryCompatibleIndicators = indicators.filter((option) =>
    isIndicatorAvailableForAnyCountry(selectedCountries, option),
  );

  useEffect(() => {
    if (!countryCompatibleIndicators.length) {
      return;
    }

    const compatibleIndicatorValueSet = new Set(countryCompatibleIndicators.map((option) => option.value));
    const nextSelectedIndicators = selectedIndicators.filter((value) => compatibleIndicatorValueSet.has(value));

    if (nextSelectedIndicators.length !== selectedIndicators.length) {
      setSelectedIndicators(nextSelectedIndicators);
      setNoticeTone("idle");
      setNoticeMessage(EXPLORER_MESSAGES.filteredIndicators);
    }
  }, [countryCompatibleIndicators, selectedIndicators]);

  useEffect(() => {
    if (!metadata) {
      return;
    }

    setNoticeTone("idle");
    setNoticeMessage(EXPLORER_MESSAGES.metadataLoaded(metadata.countries.length, metadata.indicators.length));
  }, [metadata]);

  useEffect(() => {
    if (!selectedCountries.length || !selectedIndicators.length) {
      availableRangeRef.current = null;
      setAvailableRange(null);
      setIsRangeLoading(false);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    setIsRangeLoading(true);

    void fetchBulkSeriesRange(
      {
        countries: selectedCountries,
        indicators: selectedIndicators,
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
          setNoticeTone(error.code === "NO_DATA" || error.code === "NO_DATA_AFTER_FALLBACK" ? "empty" : "error");
          setNoticeMessage(getFriendlyErrorMessage(SOURCE_LABEL, error.code, error.message));
        } else {
          setNoticeTone("error");
          setNoticeMessage(EXPLORER_MESSAGES.genericError);
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
  }, [selectedCountries, selectedIndicators]);

  const selectedCountryOptions = countries.filter((option) => selectedCountries.includes(option.value));
  const selectedIndicatorOptions = countryCompatibleIndicators.filter((option) => selectedIndicators.includes(option.value));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!selectedCountries.length || !selectedIndicators.length) {
      setNoticeTone("error");
      setNoticeMessage(EXPLORER_MESSAGES.selectionRequired);
      return;
    }

    if (!availableRange) {
      setNoticeTone("error");
      setNoticeMessage("Please wait for the available year range to finish loading.");
      return;
    }

    setIsLoading(true);
    setNoticeTone("idle");
    setNoticeMessage(EXPLORER_MESSAGES.gettingData);

    try {
      const payload = {
        countries: selectedCountries,
        indicators: selectedIndicators,
        ...toDateFilterPayload(dateFilter),
      };

      const result = await fetchBulkSeriesData(payload);
      if (!result.rows.length) {
        setNoticeTone("empty");
        setNoticeMessage(EXPLORER_MESSAGES.noData);
        return;
      }

      setNoticeMessage(EXPLORER_MESSAGES.creatingExcel);
      await downloadBulkSeriesExcel(payload);

      setNoticeTone("success");
      setNoticeMessage(buildDownloadSuccessMessage({ rowCount: result.rows.length, sourceLabel: SOURCE_LABEL, warnings: result.warnings }));
    } catch (error) {
      if (error instanceof BackendClientError) {
        setNoticeTone(error.code === "NO_DATA" || error.code === "NO_DATA_AFTER_FALLBACK" ? "empty" : "error");
        setNoticeMessage(getFriendlyErrorMessage(SOURCE_LABEL, error.code, error.message));
      } else {
        setNoticeTone("error");
        setNoticeMessage(EXPLORER_MESSAGES.genericError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="appBootstrap">
      {isAppReady ? (
        <div className="appBootstrapContent">
          <ExplorerPageShell
            description="Search the live IMF catalog, keep region-specific datasets compatible with your country mix, use a selection-aware year range, and export a clean Excel workbook through the FastAPI backend."
            stats={[
              { label: "Countries / regions", value: metadata?.countries.length ?? "..." },
              { label: "Indicators", value: metadata?.indicators.length ?? "..." },
            ]}
            subheading="powered by Alchemy Research & Analytics"
            title="Open Data Grid"
          >
            <form className="panelForm" onSubmit={handleSubmit}>
              <div className="catalogNote">
                <strong>Live IMF catalog</strong>
                <span>
                  Type to search, move with the keyboard, and let the year range update from your selected countries and
                  indicators. {REGION_SPECIFIC_DATASET_HINT}
                </span>
              </div>

              <SearchableDropdown
                disabled={isLoading}
                emptyMessage="No country or region matched that search."
                helperText="Search by country name or ISO code. Multi-select stays responsive while you move with the keyboard."
                id="imf-country-search"
                label="Countries / Regions"
                options={countries}
                placeholder="Search country or ISO code..."
                query={countryQuery}
                selectedValues={selectedCountries}
                selectionMode="multiple"
                setQuery={setCountryQuery}
                onChange={setSelectedCountries}
              />

              <SearchableDropdown
                disabled={isLoading}
                emptyMessage="No compatible indicator matched that search."
                extraText={(option: IndicatorOption) =>
                  [option.unit, option.dataset, option.source].filter(Boolean).join(" | ")
                }
                helperText="Search by name, code, unit, dataset, or source. Compatible selections drive the year range automatically."
                id="imf-indicator-search"
                label="Indicators"
                options={countryCompatibleIndicators}
                placeholder="Search indicator, code, or unit..."
                query={indicatorQuery}
                selectedValues={selectedIndicators}
                selectionMode="multiple"
                setQuery={setIndicatorQuery}
                onChange={setSelectedIndicators}
              />

              <DateToggle
                disabled={isLoading}
                helperText={
                  availableRange
                    ? "Available years are based on the selected countries and indicators. If one series is missing a year inside this span, that cell stays blank in the export."
                    : "Select at least one country and one indicator to load the available years for this selection."
                }
                isLoading={isRangeLoading}
                maxYear={availableRange?.endYear ?? null}
                minYear={availableRange?.startYear ?? null}
                value={dateFilter}
                onChange={setDateFilter}
              />

              <SelectionSummaryCard
                items={[
                  selectedCountryOptions.length
                    ? {
                        title: `${selectedCountryOptions.length} countries / regions selected`,
                        caption:
                          selectedCountryOptions.length > 3
                            ? `${joinLabels(selectedCountryOptions)} +${selectedCountryOptions.length - 3} more`
                            : joinLabels(selectedCountryOptions),
                      }
                    : { title: "" },
                  selectedIndicatorOptions.length
                    ? {
                        title: `${selectedIndicatorOptions.length} indicators selected`,
                        caption:
                          selectedIndicatorOptions.length > 2
                            ? `${joinLabels(selectedIndicatorOptions, 2)} +${selectedIndicatorOptions.length - 2} more`
                            : joinLabels(selectedIndicatorOptions, 2),
                        details: selectedIndicatorOptions.slice(0, 2).flatMap((option) =>
                          [
                            option.unit ? `${option.label} unit: ${option.unit}` : null,
                            option.dataset ? `${option.label} dataset: ${option.dataset}` : null,
                          ].filter((value): value is string => Boolean(value)),
                        ),
                      }
                    : { title: "" },
                  {
                    caption: availableRange
                      ? `Available ${availableRange.startYear} to ${availableRange.endYear}. Missing years inside your selected span stay blank in the export.`
                      : selectedCountries.length && selectedIndicators.length
                        ? "Loading the available years for this selection."
                        : "Select at least one country and one indicator to load the available years.",
                    title: availableRange ? `Range: ${getDateFilterSummary(dateFilter)}` : "Range: Waiting for selection",
                  },
                ]}
              />

              <ActionButton
                disabled={!selectedCountries.length || !selectedIndicators.length || !availableRange || isRangeLoading}
                isLoading={isLoading}
                loadingLabel="Preparing Download..."
                type="submit"
              >
                Download Excel
              </ActionButton>

              <StatusNotice message={noticeMessage} tone={noticeTone} />
            </form>
          </ExplorerPageShell>
        </div>
      ) : null}

      {isLoadingScreenVisible ? (
        <LoadingScreen
          canRetryManually={canRetryManually}
          hasError={hasError}
          idleFooterLabel={`The page unlocks when ${SOURCE_LABEL} metadata is ready.`}
          isAutoRetrying={false}
          isReady={isAppReady}
          kicker={`${SOURCE_LABEL} Data`}
          loadingStatus={loadingStatus}
          maxRetries={maxRetries}
          onRetry={retry}
          retryAttempt={retryAttempt}
          retryHint="Check that the backend service is reachable and the API URL is set correctly, then try again."
          rotatingMessages={LOADING_MESSAGES}
          title={`Connecting to ${SOURCE_LABEL} Data Services...`}
        />
      ) : null}
    </div>
  );
}

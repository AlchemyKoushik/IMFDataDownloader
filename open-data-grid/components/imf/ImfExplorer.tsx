"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { LoadingScreen } from "@/components/LoadingScreen";
import { ExplorerPageShell } from "@/components/layout/ExplorerPageShell";
import { ActionButton } from "@/components/ui/ActionButton";
import { SearchableDropdown } from "@/components/ui/SearchableDropdown";
import { SelectDropdown } from "@/components/ui/SelectDropdown";
import { SelectionSummaryCard } from "@/components/ui/SelectionSummaryCard";
import { type NoticeTone, StatusNotice } from "@/components/ui/StatusNotice";
import { useCatalogBootstrap } from "@/hooks/useCatalogBootstrap";
import {
  BackendClientError,
  downloadBulkSeriesExcel,
  fetchBulkSeriesData,
  fetchMetadata,
  getApiBaseUrl,
  primeMetadataCache,
} from "@/lib/backendClient";
import { REGION_SPECIFIC_DATASET_HINT, isIndicatorAvailableForAnyCountry } from "@/lib/datasetValidation";
import {
  buildDownloadSuccessMessage,
  getExplorerNoticeMessages,
  getFriendlyErrorMessage,
  getLoadingScreenMessages,
} from "@/lib/noticeMessages";
import type { IndicatorOption, MetadataResponsePayload, SelectOption } from "@/types/imf";

const MIN_COUNTRY_COUNT = 200;
const MIN_INDICATOR_COUNT = 100;
const SOURCE_LABEL = "IMF";
const EXPLORER_MESSAGES = getExplorerNoticeMessages(SOURCE_LABEL);
const LOADING_MESSAGES = getLoadingScreenMessages(SOURCE_LABEL);

const LATEST_YEAR_OPTIONS = [
  { label: "Latest 5 Years", value: "5" },
  { label: "Latest 10 Years", value: "10" },
  { label: "Latest 20 Years", value: "20" },
];

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
  const [selectedLatestYears, setSelectedLatestYears] = useState("10");
  const [isLoading, setIsLoading] = useState(false);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("idle");
  const [noticeMessage, setNoticeMessage] = useState(EXPLORER_MESSAGES.initial);

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
      return;
    }
  }, [countryCompatibleIndicators, selectedIndicators]);

  useEffect(() => {
    if (!metadata) {
      return;
    }

    setNoticeTone("idle");
    setNoticeMessage(EXPLORER_MESSAGES.metadataLoaded(metadata.countries.length, metadata.indicators.length));
  }, [metadata]);

  const selectedCountryOptions = countries.filter((option) => selectedCountries.includes(option.value));
  const selectedIndicatorOptions = countryCompatibleIndicators.filter((option) => selectedIndicators.includes(option.value));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!selectedCountries.length || !selectedIndicators.length) {
      setNoticeTone("error");
      setNoticeMessage(EXPLORER_MESSAGES.selectionRequired);
      return;
    }

    setIsLoading(true);
    setNoticeTone("idle");
    setNoticeMessage(EXPLORER_MESSAGES.gettingData);

    try {
      const payload = {
        countries: selectedCountries,
        indicators: selectedIndicators,
        latestYears: Number(selectedLatestYears),
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
            description="Search the live IMF catalog, fetch time-series data through a dedicated FastAPI backend, and download a clean Excel export without proxy-related failures."
            eyebrow="Powered by IMF API"
            stats={[
              { label: "Countries / regions", value: metadata?.countries.length ?? "..." },
              { label: "Indicators", value: metadata?.indicators.length ?? "..." },
            ]}
            title="IMF World Economic Outlook Data."
          >
            <form className="panelForm" onSubmit={handleSubmit}>
              <div className="catalogNote">
                <strong>Live IMF catalog</strong>
                <span>
                  Type to search, arrows to navigate, Enter to select. Export 5/10/20 years with auto-fallback.
                  {" "}
                  {REGION_SPECIFIC_DATASET_HINT}
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
                helperText="Search by name, code, unit, dataset, or source. Region-specific indicators stay available whenever at least one selected country supports them."
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

              <SelectDropdown
                disabled={isLoading}
                emptyMessage="No latest-year options are available."
                helperText="Choose a themed latest-years window. If the newest IMF window is unavailable, the export falls back to the last available range and tells you which years were used."
                id="imf-latest-years"
                label="Date Range"
                options={LATEST_YEAR_OPTIONS}
                placeholder="Choose a latest-years range..."
                selectedValue={selectedLatestYears}
                onChange={setSelectedLatestYears}
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
                ]}
              />

              <ActionButton
                disabled={!selectedCountries.length || !selectedIndicators.length}
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

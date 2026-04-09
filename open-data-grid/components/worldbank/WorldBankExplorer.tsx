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
import { BackendClientError, getApiBaseUrl } from "@/lib/backendClient";
import {
  buildDownloadSuccessMessage,
  getExplorerNoticeMessages,
  getFriendlyErrorMessage,
  getLoadingScreenMessages,
} from "@/lib/noticeMessages";
import { downloadWorldBankExcel, fetchWorldBankData, fetchWorldBankMetadata } from "@/lib/worldBankClient";
import type { SelectOption } from "@/types/imf";
import type { WorldBankDataRequestPayload, WorldBankMetadataResponsePayload } from "@/types/worldbank";

const SOURCE_LABEL = "World Bank";
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

export function WorldBankExplorer() {
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
  } = useCatalogBootstrap<WorldBankMetadataResponsePayload>({
    getFallbackErrorMessage: () => EXPLORER_MESSAGES.metadataError(getApiBaseUrl()),
    load: fetchWorldBankMetadata,
    successMessage: (payload) => EXPLORER_MESSAGES.metadataLoadedStatus(payload.countries.length, payload.indicators.length),
    validate: (payload) => {
      if (!payload.countries.length || !payload.indicators.length) {
        throw new Error("Incomplete World Bank metadata received.");
      }
    },
  });

  const countries = metadata?.countries ?? [];
  const indicators = metadata?.indicators ?? [];
  const selectedCountryOptions = countries.filter((option) => selectedCountries.includes(option.value));
  const selectedIndicatorOptions = indicators.filter((option) => selectedIndicators.includes(option.value));

  useEffect(() => {
    if (!metadata) {
      return;
    }

    setNoticeTone("idle");
    setNoticeMessage(EXPLORER_MESSAGES.metadataLoaded(metadata.countries.length, metadata.indicators.length));
  }, [metadata]);

  const buildRequestPayload = (): WorldBankDataRequestPayload | null => {
    if (!selectedCountries.length || !selectedIndicators.length) {
      setNoticeTone("error");
      setNoticeMessage(EXPLORER_MESSAGES.selectionRequired);
      return null;
    }

    const payload: WorldBankDataRequestPayload = {
      countries: selectedCountries,
      indicators: selectedIndicators,
      latestYears: Number(selectedLatestYears),
    };

    return payload;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const payload = buildRequestPayload();
    if (!payload) {
      return;
    }

    setIsLoading(true);
    setNoticeTone("idle");
    setNoticeMessage(EXPLORER_MESSAGES.gettingData);

    try {
      const result = await fetchWorldBankData(payload);
      if (!result.rows.length) {
        setNoticeTone("empty");
        setNoticeMessage(EXPLORER_MESSAGES.noData);
        return;
      }

      setNoticeMessage(EXPLORER_MESSAGES.creatingExcel);
      await downloadWorldBankExcel(payload);

      setNoticeTone("success");
      setNoticeMessage(buildDownloadSuccessMessage({ rowCount: result.rows.length, sourceLabel: SOURCE_LABEL, warnings: result.warnings }));
    } catch (error) {
      if (error instanceof BackendClientError) {
        setNoticeTone(error.code === "NO_DATA" ? "empty" : "error");
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
            description="Search the full World Bank catalog, combine multiple countries and indicators, normalize paginated API results, and export a clean Excel workbook from the same FastAPI backend."
            stats={[
              { label: "Countries", value: metadata?.countries.length ?? "..." },
              { label: "Indicators", value: metadata?.indicators.length ?? "..." },
            ]}
            subheading="powered by Alchemy Research & Analytics"
            title="Open Data Grid"
          >
            <form className="panelForm" onSubmit={handleSubmit}>
              <div className="catalogNote">
                <strong>Live World Bank catalog</strong>
                <span>
                  Search the full country and indicator lists, toggle multiple selections, and export the latest 5, 10,
                  or 20 years with automatic fallback to the last available range when newer data is missing.
                </span>
              </div>

              <SearchableDropdown
                disabled={isLoading}
                emptyMessage="No country matched that search."
                helperText="Search by country name or code. Press Enter or click to toggle multiple countries."
                id="worldbank-country-search"
                label="Countries"
                options={countries}
                placeholder="Search country or ISO Code..."
                query={countryQuery}
                selectedValues={selectedCountries}
                selectionMode="multiple"
                setQuery={setCountryQuery}
                onChange={setSelectedCountries}
              />

              <SearchableDropdown
                disabled={isLoading}
                emptyMessage="No indicator matched that search."
                helperText="Search by indicator name or code. Results are cached and paginated server-side."
                id="worldbank-indicator-search"
                label="Indicators"
                options={indicators}
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
                helperText="Choose a themed latest-years window. If the newest window is unavailable, the export falls back to the last available range and tells you which years were used."
                id="worldbank-latest-years"
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
                        title: `${selectedCountryOptions.length} countries selected`,
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

"use client";

import type { MutableRefObject, ReactNode } from "react";
import { createContext, startTransition, useContext, useEffect, useRef, useState } from "react";

import { LoadingScreen } from "@/components/LoadingScreen";
import { fetchCountries, fetchIndicators, primeMetadataCache } from "@/lib/imfClient";
import type { MetadataResponsePayload } from "@/types/imf";

const LOADER_EXIT_MS = 500;
const MAX_RETRIES = 3;
const MIN_COUNTRY_COUNT = 200;
const MIN_INDICATOR_COUNT = 100;
const RETRY_DELAY_MS = 3_000;
const RETRY_STORAGE_KEY = "imf-app-retry-count";

interface AppReadyContextValue {
  hasError: boolean;
  isAppReady: boolean;
  loadingStatus: string;
  metadata: MetadataResponsePayload | null;
}

const AppReadyContext = createContext<AppReadyContextValue | null>(null);

const clearTimeoutRef = (timeoutRef: MutableRefObject<number | null>): void => {
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
};

export function AppReadyProvider({ children }: { children: ReactNode }) {
  const [metadata, setMetadata] = useState<MetadataResponsePayload | null>(null);
  const [isAppReady, setIsAppReady] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Preparing IMF connection...");
  const [hasError, setHasError] = useState(false);
  const [isLoadingScreenVisible, setIsLoadingScreenVisible] = useState(true);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  const [canRetryManually, setCanRetryManually] = useState(false);
  const reloadTimeoutRef = useRef<number | null>(null);
  const hideLoaderTimeoutRef = useRef<number | null>(null);

  const clearTimers = (): void => {
    clearTimeoutRef(reloadTimeoutRef);
    clearTimeoutRef(hideLoaderTimeoutRef);
  };

  const bootstrapApp = async (mode: "auto" | "manual" = "auto"): Promise<void> => {
    if (typeof window === "undefined") {
      return;
    }

    clearTimers();
    setHasError(false);
    setIsAutoRetrying(false);
    setCanRetryManually(false);
    setIsAppReady(false);
    setIsLoadingScreenVisible(true);
    setMetadata(null);
    setLoadingStatus("Establishing secure connection...");

    try {
      setLoadingStatus("Fetching IMF country catalog...");
      const countries = await fetchCountries();

      setLoadingStatus("Loading indicators and datasets...");
      const indicators = await fetchIndicators();

      if (countries.length < MIN_COUNTRY_COUNT || indicators.length < MIN_INDICATOR_COUNT) {
        throw new Error("Incomplete IMF metadata received.");
      }

      const nextMetadata: MetadataResponsePayload = {
        countries,
        indicators,
        lastUpdated: new Date().toISOString(),
      };

      primeMetadataCache(nextMetadata);
      window.sessionStorage.removeItem(RETRY_STORAGE_KEY);
      setRetryAttempt(0);
      setLoadingStatus(`${countries.length} countries/regions and ${indicators.length} indicators loaded. API connection secured.`);

      startTransition(() => {
        setMetadata(nextMetadata);
        setIsAppReady(true);
      });

      hideLoaderTimeoutRef.current = window.setTimeout(() => {
        setIsLoadingScreenVisible(false);
      }, LOADER_EXIT_MS);
    } catch {
      setHasError(true);
      const retries = Number(window.sessionStorage.getItem(RETRY_STORAGE_KEY) || "0");

      if (mode === "auto" && retries < MAX_RETRIES) {
        const nextRetry = retries + 1;

        window.sessionStorage.setItem(RETRY_STORAGE_KEY, String(nextRetry));
        setRetryAttempt(nextRetry);
        setIsAutoRetrying(true);
        setLoadingStatus("Connection failed. Retrying...");

        reloadTimeoutRef.current = window.setTimeout(() => {
          window.location.reload();
        }, RETRY_DELAY_MS);

        return;
      }

      window.sessionStorage.removeItem(RETRY_STORAGE_KEY);
      setRetryAttempt(Math.max(retries, 1));
      setCanRetryManually(true);
      setLoadingStatus("Unable to connect. Please check your network.");
    }
  };

  const handleManualRetry = (): void => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.removeItem(RETRY_STORAGE_KEY);
    setRetryAttempt(0);
    void bootstrapApp("manual");
  };

  useEffect(() => {
    void bootstrapApp("auto");

    return () => {
      clearTimers();
    };
  }, []);

  return (
    <AppReadyContext.Provider
      value={{
        hasError,
        isAppReady,
        loadingStatus,
        metadata,
      }}
    >
      <div className="appBootstrap">
        {isAppReady ? <div className="appBootstrapContent">{children}</div> : null}

        {isLoadingScreenVisible ? (
          <LoadingScreen
            canRetryManually={canRetryManually}
            hasError={hasError}
            isAutoRetrying={isAutoRetrying}
            isReady={isAppReady}
            loadingStatus={loadingStatus}
            maxRetries={MAX_RETRIES}
            onRetry={handleManualRetry}
            retryAttempt={retryAttempt}
          />
        ) : null}
      </div>
    </AppReadyContext.Provider>
  );
}

export function useAppReady(): AppReadyContextValue {
  const context = useContext(AppReadyContext);

  if (!context) {
    throw new Error("useAppReady must be used within AppReadyProvider.");
  }

  return context;
}

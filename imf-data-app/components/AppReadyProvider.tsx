"use client";

import type { MutableRefObject, ReactNode } from "react";
import { createContext, startTransition, useContext, useEffect, useRef, useState } from "react";

import { LoadingScreen } from "@/components/LoadingScreen";
import { BackendClientError, fetchMetadata, primeMetadataCache } from "@/lib/backendClient";
import type { MetadataResponsePayload } from "@/types/imf";

const LOADER_EXIT_MS = 500;
const MIN_COUNTRY_COUNT = 200;
const MIN_INDICATOR_COUNT = 100;
const RETRY_COUNTER_LIMIT = 3;

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
  const [canRetryManually, setCanRetryManually] = useState(false);
  const hideLoaderTimeoutRef = useRef<number | null>(null);

  const clearTimers = (): void => {
    clearTimeoutRef(hideLoaderTimeoutRef);
  };

  const bootstrapApp = async (): Promise<void> => {
    if (typeof window === "undefined") {
      return;
    }

    clearTimers();
    setHasError(false);
    setCanRetryManually(false);
    setIsAppReady(false);
    setIsLoadingScreenVisible(true);
    setMetadata(null);
    setLoadingStatus("Connecting to backend services...");
    setRetryAttempt((current) => Math.min(current + 1, RETRY_COUNTER_LIMIT));

    try {
      setLoadingStatus("Loading IMF catalog through FastAPI...");
      const nextMetadata = await fetchMetadata();

      if (nextMetadata.countries.length < MIN_COUNTRY_COUNT || nextMetadata.indicators.length < MIN_INDICATOR_COUNT) {
        throw new Error("Incomplete IMF metadata received.");
      }

      primeMetadataCache(nextMetadata);
      setRetryAttempt(0);
      setLoadingStatus(
        `${nextMetadata.countries.length} countries/regions and ${nextMetadata.indicators.length} indicators loaded.`,
      );

      startTransition(() => {
        setMetadata(nextMetadata);
        setIsAppReady(true);
      });

      hideLoaderTimeoutRef.current = window.setTimeout(() => {
        setIsLoadingScreenVisible(false);
      }, LOADER_EXIT_MS);
    } catch (error) {
      setHasError(true);
      setCanRetryManually(true);

      if (error instanceof BackendClientError) {
        setLoadingStatus(error.message);
        return;
      }

      setLoadingStatus("Unable to load metadata. Make sure the FastAPI backend is running on port 8000.");
    }
  };

  const handleManualRetry = (): void => {
    void bootstrapApp();
  };

  useEffect(() => {
    void bootstrapApp();

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
            isAutoRetrying={false}
            isReady={isAppReady}
            loadingStatus={loadingStatus}
            maxRetries={RETRY_COUNTER_LIMIT}
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

"use client";

import type { MutableRefObject } from "react";
import { startTransition, useEffect, useRef, useState } from "react";

import { BackendClientError } from "@/lib/backendClient";

const LOADER_EXIT_MS = 500;
const RETRY_COUNTER_LIMIT = 3;

interface UseCatalogBootstrapOptions<T> {
  getFallbackErrorMessage: () => string;
  load: () => Promise<T>;
  successMessage: (payload: T) => string;
  validate: (payload: T) => void;
}

interface UseCatalogBootstrapResult<T> {
  canRetryManually: boolean;
  data: T | null;
  hasError: boolean;
  isAppReady: boolean;
  isLoadingScreenVisible: boolean;
  loadingStatus: string;
  maxRetries: number;
  retry: () => void;
  retryAttempt: number;
}

const clearTimeoutRef = (timeoutRef: MutableRefObject<number | null>): void => {
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
};

export function useCatalogBootstrap<T>({
  getFallbackErrorMessage,
  load,
  successMessage,
  validate,
}: UseCatalogBootstrapOptions<T>): UseCatalogBootstrapResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isAppReady, setIsAppReady] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Connecting to backend services...");
  const [hasError, setHasError] = useState(false);
  const [isLoadingScreenVisible, setIsLoadingScreenVisible] = useState(true);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [canRetryManually, setCanRetryManually] = useState(false);
  const hideLoaderTimeoutRef = useRef<number | null>(null);
  const loadRef = useRef(load);
  const validateRef = useRef(validate);
  const successMessageRef = useRef(successMessage);
  const fallbackMessageRef = useRef(getFallbackErrorMessage);

  loadRef.current = load;
  validateRef.current = validate;
  successMessageRef.current = successMessage;
  fallbackMessageRef.current = getFallbackErrorMessage;

  const bootstrapCatalog = async (): Promise<void> => {
    if (typeof window === "undefined") {
      return;
    }

    clearTimeoutRef(hideLoaderTimeoutRef);
    setHasError(false);
    setCanRetryManually(false);
    setIsAppReady(false);
    setIsLoadingScreenVisible(true);
    setData(null);
    setLoadingStatus("Connecting to backend services...");
    setRetryAttempt((current) => Math.min(current + 1, RETRY_COUNTER_LIMIT));

    try {
      const payload = await loadRef.current();
      validateRef.current(payload);

      setRetryAttempt(0);
      setLoadingStatus(successMessageRef.current(payload));

      startTransition(() => {
        setData(payload);
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

      setLoadingStatus(fallbackMessageRef.current());
    }
  };

  useEffect(() => {
    void bootstrapCatalog();

    return () => {
      clearTimeoutRef(hideLoaderTimeoutRef);
    };
  }, []);

  return {
    canRetryManually,
    data,
    hasError,
    isAppReady,
    isLoadingScreenVisible,
    loadingStatus,
    maxRetries: RETRY_COUNTER_LIMIT,
    retry: () => {
      void bootstrapCatalog();
    },
    retryAttempt,
  };
}

"use client";

import { useEffect, useState } from "react";

const LOADING_MESSAGES = [
  "Establishing secure connection...",
  "Fetching IMF country catalog...",
  "Loading indicators and datasets...",
  "Preparing data environment...",
  "Almost ready...",
];

const MESSAGE_ROTATE_MS = 2_400;

interface LoadingScreenProps {
  canRetryManually: boolean;
  hasError: boolean;
  isAutoRetrying: boolean;
  isReady: boolean;
  loadingStatus: string;
  maxRetries: number;
  onRetry: () => void;
  retryAttempt: number;
}

export function LoadingScreen({
  canRetryManually,
  hasError,
  isAutoRetrying,
  isReady,
  loadingStatus,
  maxRetries,
  onRetry,
  retryAttempt,
}: LoadingScreenProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (hasError || isReady) {
      return;
    }

    const interval = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % LOADING_MESSAGES.length);
    }, MESSAGE_ROTATE_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasError, isReady]);

  useEffect(() => {
    if (hasError) {
      setMessageIndex(0);
    }
  }, [hasError]);

  const dynamicMessage = hasError
    ? isAutoRetrying
      ? "Retrying connection to IMF services..."
      : "Automatic retries finished. You can retry once your connection is stable."
    : LOADING_MESSAGES[messageIndex];

  const progress = hasError
    ? isAutoRetrying
      ? 42
      : 100
    : ((messageIndex + 1) / LOADING_MESSAGES.length) * 100;

  return (
    <div
      className={`loadingScreen${isReady ? " loadingScreen-exit" : ""}`}
      aria-busy={!isReady}
      aria-live="polite"
      role="status"
    >
      <div className="loadingCard">
        <div className="loadingOrb" aria-hidden="true">
          <span className="loadingSpinner" />
          <span className="loadingPulse loadingPulse-primary" />
          <span className="loadingPulse loadingPulse-secondary" />
        </div>

        <p className="loadingKicker">IMF Data Downloader</p>
        <h2>Connecting to IMF Data Services...</h2>
        <p className={`loadingMessage${hasError ? " loadingMessage-error" : ""}`}>{dynamicMessage}</p>

        <div className="loadingProgress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="loadingStatusRow">
          <span
            className={`loadingStatusDot${hasError ? " loadingStatusDot-error" : ""}${
              isAutoRetrying ? " loadingStatusDot-pulse" : ""
            }`}
          />
          <span>{loadingStatus}</span>
        </div>

        <div className="loadingFoot">
          {hasError ? (
            <>
              <span>
                Attempt {Math.min(retryAttempt, maxRetries)} of {maxRetries}
              </span>
              {isAutoRetrying ? (
                <span className="loadingRetryBlink">Refreshing in 3 seconds...</span>
              ) : (
                <button className="loadingRetryButton" type="button" onClick={onRetry}>
                  Retry now
                </button>
              )}
            </>
          ) : (
            <>
              <span>Metadata bootstrap in progress</span>
              <span>UI unlocks after the IMF catalog passes validation.</span>
            </>
          )}
        </div>

        {canRetryManually ? (
          <p className="loadingHint">Your last automatic retry did not succeed, so the app is waiting for manual retry.</p>
        ) : null}
      </div>
    </div>
  );
}

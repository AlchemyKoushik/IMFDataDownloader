"use client";

import { useEffect, useState } from "react";

const MESSAGE_ROTATE_MS = 2_400;

interface LoadingScreenProps {
  canRetryManually: boolean;
  hasError: boolean;
  idleFooterLabel: string;
  isAutoRetrying: boolean;
  isReady: boolean;
  kicker: string;
  loadingStatus: string;
  maxRetries: number;
  onRetry: () => void;
  retryHint: string;
  rotatingMessages: string[];
  title: string;
  retryAttempt: number;
}

export function LoadingScreen({
  canRetryManually,
  hasError,
  idleFooterLabel,
  isAutoRetrying,
  isReady,
  kicker,
  loadingStatus,
  maxRetries,
  onRetry,
  retryHint,
  rotatingMessages,
  title,
  retryAttempt,
}: LoadingScreenProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (hasError || isReady) {
      return;
    }

    const interval = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % rotatingMessages.length);
    }, MESSAGE_ROTATE_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasError, isReady, rotatingMessages.length]);

  useEffect(() => {
    if (hasError) {
      setMessageIndex(0);
    }
  }, [hasError]);

  const dynamicMessage = hasError
    ? isAutoRetrying
      ? `Retrying connection to ${kicker} services...`
      : `Unable to reach the backend or ${kicker} services. Start the FastAPI server and retry.`
    : rotatingMessages[messageIndex];

  const progress = hasError
    ? isAutoRetrying
      ? 42
      : 100
    : ((messageIndex + 1) / rotatingMessages.length) * 100;

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

        <p className="loadingKicker">{kicker}</p>
        <h2>{title}</h2>
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
                Attempt {Math.max(Math.min(retryAttempt, maxRetries), 1)} of {maxRetries}
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
              <span>{idleFooterLabel}</span>
            </>
          )}
        </div>

        {canRetryManually ? (
          <p className="loadingHint">{retryHint}</p>
        ) : null}
      </div>
    </div>
  );
}

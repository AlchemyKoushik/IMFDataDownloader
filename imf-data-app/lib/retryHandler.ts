export interface RequestErrorOptions {
  code?: string;
  status?: number;
  retryable?: boolean;
  cause?: unknown;
}

export class RequestError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryable: boolean;

  constructor(message: string, options: RequestErrorOptions = {}) {
    super(message);
    this.name = "RequestError";
    this.code = options.code ?? "REQUEST_ERROR";
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface RetryContext {
  attempt: number;
  signal: AbortSignal;
}

export interface RetryOptions {
  maxRetries?: number;
  backoffMs?: number[];
  timeoutMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_BACKOFF_MS = [500, 1000, 2000];

const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

export const isAbortError = (error: unknown): boolean => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }

  return error instanceof Error && error.name === "AbortError";
};

const isNetworkError = (error: unknown): boolean => error instanceof TypeError;

export const isRetryableRequestError = (error: unknown): boolean => {
  if (error instanceof RequestError) {
    return error.retryable;
  }

  return isAbortError(error) || isNetworkError(error);
};

export async function retryWithBackoff<T>(
  operation: (context: RetryContext) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const shouldRetry = options.shouldRetry ?? isRetryableRequestError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await operation({
        attempt,
        signal: controller.signal,
      });

      if (result === null || result === undefined) {
        throw new RequestError("The upstream service returned an empty response.", {
          code: "EMPTY_RESPONSE",
          status: 502,
          retryable: true,
        });
      }

      return result;
    } catch (error) {
      lastError = error;
      const hasRemainingAttempts = attempt < maxRetries;

      if (!hasRemainingAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
      await wait(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ??
    new RequestError("The request failed after exhausting all retries.", {
      code: "RETRY_EXHAUSTED",
      status: 502,
      retryable: false,
    })
  );
}

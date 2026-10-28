export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      status?: number;
      retryable?: boolean;
      retryAfterMs?: number;
      code?: 'auth' | 'rate-limit' | 'network' | 'timeout' | 'invalid-response' | 'cancelled' | 'config' | 'server' | 'refusal';
    } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError')) ||
    (error instanceof ProviderError && error.options.code === 'cancelled')
  );
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('Cancelled', { code: 'cancelled' }));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError('Cancelled', { code: 'cancelled' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Retry with exponential backoff and jitter. Only errors marked retryable are retried, the
 * number of attempts is always bounded, and a `Retry-After` hint is honoured (capped).
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = Math.min(options.retries ?? 2, 5);
  const base = options.baseDelayMs ?? 600;
  const max = options.maxDelayMs ?? 8_000;
  const wait = options.sleep ?? sleep;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt >= retries) throw error;
      const hinted = error instanceof ProviderError ? error.options.retryAfterMs : undefined;
      const backoff = Math.min(max, base * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      const delay = Math.min(max, hinted ?? backoff);
      options.onRetry?.(attempt + 1, delay, error);
      await wait(delay, options.signal);
      attempt += 1;
    }
  }
}

export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Classify an HTTP status into a user-facing, secret-free ProviderError. */
export function errorFromStatus(status: number, providerName: string, retryAfter?: string | null): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(`${providerName} rejected the API key (HTTP ${status}). Check the key in Settings.`, {
      status,
      code: 'auth',
    });
  }
  if (status === 404) {
    return new ProviderError(`${providerName} could not find that model or endpoint (HTTP 404). Check the model name and base URL.`, {
      status,
      code: 'config',
    });
  }
  if (status === 429) {
    return new ProviderError(`${providerName} rate limit reached. Retrying shortly…`, {
      status,
      code: 'rate-limit',
      retryable: true,
      retryAfterMs: parseRetryAfter(retryAfter),
    });
  }
  if (status === 408 || status >= 500) {
    return new ProviderError(`${providerName} is temporarily unavailable (HTTP ${status}).`, {
      status,
      code: 'server',
      retryable: true,
    });
  }
  return new ProviderError(`${providerName} returned an error (HTTP ${status}).`, { status, code: 'config' });
}

/** Remove anything that looks like a credential from a message before it is shown or logged. */
export function redactSecrets(message: string, secrets: Array<string | undefined | null> = []): string {
  let result = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) result = result.split(secret).join('[redacted]');
  }
  return result
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b(Bearer|Token)\s+[A-Za-z0-9._-]{8,}/gi, '$1 [redacted]')
    .replace(/([?&](api_?key|key|token)=)[^&\s]+/gi, '$1[redacted]');
}

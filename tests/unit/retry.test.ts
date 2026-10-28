import { ProviderError, errorFromStatus, isAbortError, parseRetryAfter, redactSecrets, sleep, withRetry } from '../../src/shared/core/retry';

const noWait = () => Promise.resolve();

describe('withRetry', () => {
  it('retries retryable errors a bounded number of times', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('busy', { retryable: true }));
    await expect(withRetry(fn, { retries: 2, sleep: noWait })).rejects.toThrow('busy');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries more than 5 times even if asked', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('busy', { retryable: true }));
    await expect(withRetry(fn, { retries: 100, sleep: noWait })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('bad key', { code: 'auth' }));
    await expect(withRetry(fn, { sleep: noWait })).rejects.toThrow('bad key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the first success and honours Retry-After', async () => {
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('slow down', { retryable: true, retryAfterMs: 1_234 }))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { sleep: async (ms) => void delays.push(ms) })).resolves.toBe('ok');
    expect(delays).toEqual([1_234]);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new ProviderError('busy', { retryable: true });
    });
    await expect(withRetry(fn, { signal: controller.signal, sleep: noWait })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('sleep', () => {
  it('rejects when aborted', async () => {
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
  });
});

describe('errorFromStatus', () => {
  it('maps HTTP statuses to friendly, typed errors', () => {
    expect(errorFromStatus(401, 'X')).toMatchObject({ retryable: false, options: { code: 'auth' } });
    expect(errorFromStatus(404, 'X').options.code).toBe('config');
    expect(errorFromStatus(429, 'X', '3')).toMatchObject({ retryable: true, options: { retryAfterMs: 3_000 } });
    expect(errorFromStatus(503, 'X').retryable).toBe(true);
    expect(errorFromStatus(400, 'X').retryable).toBe(false);
  });

  it('parses Retry-After values', () => {
    expect(parseRetryAfter('2')).toBe(2_000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('garbage')).toBeUndefined();
  });
});

describe('redactSecrets', () => {
  it('removes known secrets and key-shaped strings', () => {
    const message = redactSecrets('failed with sk-ant-abcdefghijk123 and Bearer abc.def.ghijkl and my-secret-value ?key=zzz', [
      'my-secret-value',
    ]);
    expect(message).not.toContain('sk-ant-abcdefghijk123');
    expect(message).not.toContain('abc.def.ghijkl');
    expect(message).not.toContain('my-secret-value');
    expect(message).not.toContain('zzz');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { Backoff, isRetryableError, withRetry } from './retry.js';

describe('withRetry', () => {
  it('retries transient failures with exponential backoff and returns the first success', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await withRetry(fn, { baseMs: 100, sleep, jitter: () => 1 })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it('gives up after the last attempt and does not retry a refusal', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withRetry(() => Promise.reject(new Error('down')), { attempts: 3, sleep, jitter: () => 1 })).rejects.toThrow('down');
    expect(sleep).toHaveBeenCalledTimes(2);

    const forbidden = Object.assign(new Error('nope'), { data: { code: 'FORBIDDEN' } });
    const fn = vi.fn().mockRejectedValue(forbidden);
    await expect(withRetry(fn, { sleep })).rejects.toBe(forbidden);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRetryableError(forbidden)).toBe(false);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
  });
});

describe('Backoff', () => {
  it('doubles while failing, caps, and snaps back on success', () => {
    const b = new Backoff(1000, 5000);
    expect(b.delayMs).toBe(1000);
    b.failure(); expect(b.delayMs).toBe(2000);
    b.failure(); expect(b.delayMs).toBe(4000);
    b.failure(); expect(b.delayMs).toBe(5000);
    b.success(); expect(b.delayMs).toBe(1000);
  });
});

/**
 * Reconnect and backoff for the runner's calls to the app (Exponential
 * ADR-0067). A laptop runner loses the network, sleeps, or hits a deploy;
 * the app-side procedures are idempotent (appendEvents on seq, finish and
 * heartbeat guarded on status), so retrying is always safe.
 */

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** First delay; doubles each time, capped. */
  baseMs?: number;
  maxMs?: number;
  /** Decide whether an error is worth retrying (default: everything but a 4xx-style refusal). */
  retryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Deterministic jitter for tests; default random in [0.5, 1.5). */
  jitter?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** tRPC client errors carry the server's code; a refusal will not change on retry. */
export function isRetryableError(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (!code) return true; // network / unknown — try again
  return !['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND', 'PRECONDITION_FAILED', 'BAD_REQUEST'].includes(code);
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 5;
  const baseMs = options.baseMs ?? 1000;
  const maxMs = options.maxMs ?? 30_000;
  const retryable = options.retryable ?? isRetryableError;
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? (() => 0.5 + Math.random());
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryable(error)) throw error;
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) * jitter();
      options.log?.(`retry ${attempt}/${attempts - 1} in ${Math.round(delay)}ms: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Poll interval that grows while the app is unreachable and snaps back on the first success. */
export class Backoff {
  private failures = 0;
  constructor(private readonly baseMs: number, private readonly maxMs: number = 5 * 60_000) {}

  /** Current wait, before recording an outcome. */
  get delayMs(): number {
    return Math.min(this.maxMs, this.baseMs * 2 ** this.failures);
  }
  success(): void {
    this.failures = 0;
  }
  failure(): void {
    this.failures = Math.min(this.failures + 1, 16);
  }
}

import { readFileSync } from 'node:fs';

let stdinConsumed = false;

/** Test hook: the stdin guard is process-wide state. */
export function resetStdinGuardForTests(): void {
  stdinConsumed = false;
}

/**
 * Text from an inline option value, a file path, or "-" for stdin.
 * Inline wins when both are given. stdin can back at most one option per
 * invocation — a second "-" would silently read EOF as "".
 */
export function readText(inline?: string, file?: string): string | undefined {
  if (inline !== undefined) return inline;
  if (file === undefined) return undefined;
  if (file === '-') {
    if (stdinConsumed) {
      throw new Error('stdin ("-") can only back one option per invocation.');
    }
    stdinConsumed = true;
    return readFileSync(0, 'utf-8');
  }
  return readFileSync(file, 'utf-8');
}

/**
 * Parse a user-supplied date. A date-only value ("2026-08-25") is taken as
 * LOCAL midnight — bare `new Date("2026-08-25")` would be UTC midnight, which
 * reads back as the previous day anywhere west of UTC. Empty string counts
 * as omitted; anything unparseable throws.
 */
export function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid date: "${value}". Use ISO format, e.g. 2026-08-25 or 2026-08-25T14:00.`,
    );
  }
  return date;
}

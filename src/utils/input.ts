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

export interface SelectChoice<T> {
  label: string;
  value: T;
}

/**
 * Interactive pick from a numbered list. The menu and the prompt go to stderr
 * so stdout stays clean for whatever the command then prints. Callers must
 * only reach for this when stdin and stdout are TTYs — there is no fallback
 * here; a non-interactive run has to choose a default itself.
 */
export async function selectOption<T>(
  message: string,
  choices: SelectChoice<T>[],
): Promise<T> {
  if (choices.length === 0) {
    throw new Error(`Nothing to choose from: ${message}`);
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`${message}\n`);
    choices.forEach((choice, index) => {
      process.stderr.write(`  ${index + 1}) ${choice.label}\n`);
    });
    for (;;) {
      const answer = (await rl.question(`Choose [1-${choices.length}]: `)).trim();
      const index = Number.parseInt(answer, 10);
      if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
        return choices[index - 1]!.value;
      }
      process.stderr.write(`Enter a number between 1 and ${choices.length}.\n`);
    }
  } finally {
    rl.close();
  }
}

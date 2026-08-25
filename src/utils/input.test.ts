import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readText, parseDate, resetStdinGuardForTests } from './input.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn((path: unknown) => (path === 0 ? 'from stdin' : 'from file')),
}));

beforeEach(() => {
  resetStdinGuardForTests();
});

describe('readText', () => {
  it('prefers inline text over a file', () => {
    expect(readText('inline', 'some/path')).toBe('inline');
  });

  it('returns undefined when neither source is given', () => {
    expect(readText(undefined, undefined)).toBeUndefined();
  });

  it('reads stdin for "-"', () => {
    expect(readText(undefined, '-')).toBe('from stdin');
  });

  // A second "-" would silently read EOF as "" — e.g. `create
  // --transcript-file - --notes-file -` uploading empty notes.
  it('rejects a second stdin read in the same invocation', () => {
    expect(readText(undefined, '-')).toBe('from stdin');
    expect(() => readText(undefined, '-')).toThrow('one option per invocation');
  });
});

describe('parseDate', () => {
  it('treats undefined and empty string as omitted', () => {
    expect(parseDate(undefined)).toBeUndefined();
    expect(parseDate('')).toBeUndefined();
  });

  it('parses a date-only value as LOCAL midnight', () => {
    const d = parseDate('2026-08-25')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
  });

  it('parses a datetime as local time per the JS spec', () => {
    const d = parseDate('2026-08-25T14:30')!;
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('throws on garbage', () => {
    expect(() => parseDate('not-a-date')).toThrow('Invalid date');
  });
});

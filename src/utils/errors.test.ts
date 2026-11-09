import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { TRPCClientError } from 'exponential-sdk';
import { handleError } from './errors.js';

/**
 * The server words a FORBIDDEN so the person holding the token can act on it
 * (which account was refused, what it lacks, who can grant it). The CLI used
 * to replace that with "Access denied", which is how an agent's owner ended up
 * unable to tell which account to add to a restricted project.
 */
describe('handleError', () => {
  let exit: MockInstance;
  let stderr: MockInstance;
  let stdout: MockInstance;

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exit.mockRestore();
    stderr.mockRestore();
    stdout.mockRestore();
  });

  function trpcError(code: string, message: string) {
    const error = new TRPCClientError(message);
    Object.assign(error, { data: { code } });
    return error;
  }

  it('keeps the server\'s FORBIDDEN message and points at whoami', () => {
    const message =
      'Access denied: Claude Desktop (cmsf…, an agent owned by James) can\'t view this project. ' +
      '"Manage Syntrofi" is a restricted project and Claude Desktop is not one of its members.';

    expect(() => handleError(trpcError('FORBIDDEN', message))).toThrow('exit');

    const printed = stderr.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Claude Desktop');
    expect(printed).toContain('Manage Syntrofi');
    expect(printed).toContain('exponential auth whoami');
  });

  it('emits the same message and suggestion as JSON', () => {
    expect(() => handleError(trpcError('FORBIDDEN', 'Access denied: Agent X can\'t read this page.'), true)).toThrow('exit');

    const json = JSON.parse(String(stdout.mock.calls[0]?.[0])) as {
      error: { code: string; message: string; suggestion?: string };
    };
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.error.message).toContain('Agent X');
    expect(json.error.suggestion).toContain('auth whoami');
  });

  it('keeps the server\'s NOT_FOUND message, falling back only when it is empty', () => {
    expect(() => handleError(trpcError('NOT_FOUND', 'Page not found'))).toThrow('exit');
    expect(stderr.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Page not found');

    stderr.mockClear();
    expect(() => handleError(trpcError('NOT_FOUND', ''))).toThrow('exit');
    expect(stderr.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Resource not found');
  });
});

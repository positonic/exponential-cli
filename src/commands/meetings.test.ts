import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMeetingsCommand } from './meetings.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';
import { resetStdinGuardForTests } from '../utils/input.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

vi.mock('../utils/resolve.js', () => ({
  resolveWorkspaceId: vi.fn(),
  resolveWorkspace: vi.fn(),
  resolveProductId: vi.fn(),
}));

function makeMeeting(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sessionId: `manual_${id}`,
    title: `Meeting ${id}`,
    description: null,
    notes: null,
    summary: null,
    transcription: 'hello world',
    meetingDate: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    userId: 'u1',
    projectId: null,
    workspaceId: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeClient() {
  const list = vi.fn().mockResolvedValue([]);
  const get = vi.fn().mockResolvedValue(makeMeeting('m1'));
  const create = vi.fn().mockResolvedValue(makeMeeting('m1'));
  const update = vi.fn().mockResolvedValue(makeMeeting('m1'));
  const getNotes = vi.fn().mockResolvedValue(null);
  const setNotes = vi.fn().mockResolvedValue(makeMeeting('m1'));
  const del = vi.fn().mockResolvedValue({ success: true });
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const appendNotes = vi.fn().mockResolvedValue(makeMeeting('m1'));
  const client = {
    meetings: {
      list, get, create, update, getNotes, setNotes, appendNotes,
      delete: del, deleteMany,
    },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  return { list, get, create, update, getNotes, setNotes, appendNotes, del, deleteMany };
}

async function run(args: string[]) {
  const cmd = createMeetingsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

/** All console.log output of this test, concatenated. */
function loggedText(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((c) => c.join(' '))
    .join('\n');
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetStdinGuardForTests();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
});

describe('meetings list', () => {
  it('lists without a workspace filter by default', async () => {
    const { list } = makeClient();
    await run(['list']);
    expect(list).toHaveBeenCalledWith({
      workspaceId: undefined,
      includeArchived: undefined,
      meetingType: undefined,
    });
    expect(resolveModule.resolveWorkspaceId).not.toHaveBeenCalled();
  });

  it('resolves --workspace and passes --mine/--archived through', async () => {
    const { list } = makeClient();
    await run(['list', '--workspace', 'clear', '--mine', '--archived']);
    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      includeArchived: true,
      meetingType: 'mine',
    });
  });

  // The list can cover every visible meeting; full bodies in JSON would
  // flood the agents that parse it. `get` carries the bodies.
  it('JSON rows carry presence flags instead of the large bodies', async () => {
    const { list } = makeClient();
    list.mockResolvedValue([
      makeMeeting('m1', { transcription: 'x'.repeat(10_000), notes: 'n', summary: null }),
    ]);
    await run(['list']);
    const parsed = JSON.parse(loggedText()) as {
      meetings: Record<string, unknown>[];
      total: number;
    };
    expect(parsed.total).toBe(1);
    const row = parsed.meetings[0]!;
    expect(row.hasTranscript).toBe(true);
    expect(row.hasNotes).toBe(true);
    expect(row.hasSummary).toBe(false);
    expect(row).not.toHaveProperty('transcription');
    expect(row).not.toHaveProperty('notes');
    expect(row).not.toHaveProperty('summary');
  });
});

describe('meetings get', () => {
  it('fetches by id and keeps bodies in the JSON shape', async () => {
    const { get } = makeClient();
    get.mockResolvedValue(makeMeeting('m1', { notes: 'the notes' }));
    await run(['get', 'm1']);
    expect(get).toHaveBeenCalledWith('m1');
    const parsed = JSON.parse(loggedText()) as Record<string, unknown>;
    expect(parsed.notes).toBe('the notes');
    expect(parsed.transcription).toBe('hello world');
  });
});

describe('meetings create', () => {
  it('refuses without a transcript and never calls the API', async () => {
    const { create } = makeClient();
    await expect(
      run(['create', '--title', 'Standup', '--notes', 'n']),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.join('\n')).toContain('transcript is required');
  });

  it('refuses an empty transcript file with a distinct message', async () => {
    const { create } = makeClient();
    const dir = mkdtempSync(join(tmpdir(), 'exp-cli-test-'));
    const empty = join(dir, 'empty.txt');
    writeFileSync(empty, '');
    await expect(
      run(['create', '--title', 'Standup', '--transcript-file', empty]),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.join('\n')).toContain('transcript is empty');
  });

  it('creates with transcript and notes', async () => {
    const { create } = makeClient();
    await run([
      'create',
      '--title', 'Standup',
      '--transcript', 'we talked',
      '--notes', 'decisions made',
      '--date', '2026-08-25',
    ]);
    expect(create).toHaveBeenCalledWith({
      title: 'Standup',
      transcription: 'we talked',
      notes: 'decisions made',
      description: undefined,
      // date-only input is LOCAL midnight, not UTC
      meetingDate: new Date(2026, 7, 25),
      projectId: undefined,
      workspaceId: undefined,
    });
  });

  it('reads the transcript from a file', async () => {
    const { create } = makeClient();
    const dir = mkdtempSync(join(tmpdir(), 'exp-cli-test-'));
    const file = join(dir, 'transcript.txt');
    writeFileSync(file, 'from a file');
    await run(['create', '--title', 'Standup', '--transcript-file', file]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ transcription: 'from a file' }),
    );
  });
});

describe('meetings update', () => {
  it('takes --id and passes only the provided fields', async () => {
    const { update } = makeClient();
    await run(['update', '--id', 'm1', '--notes', 'replaced']);
    expect(update).toHaveBeenCalledWith({
      id: 'm1',
      title: undefined,
      notes: 'replaced',
      summary: undefined,
      description: undefined,
      meetingDate: undefined,
    });
  });

  it('refuses a no-op update before calling the API', async () => {
    const { update } = makeClient();
    await expect(run(['update', '--id', 'm1'])).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.join('\n')).toContain('Nothing to update');
  });
});

describe('meetings notes', () => {
  it('notes get prints the raw body even when piped', async () => {
    const { getNotes } = makeClient();
    getNotes.mockResolvedValue('# Notes');
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as never);
    await run(['notes', 'get', 'm1']);
    expect(getNotes).toHaveBeenCalledWith('m1');
    expect(writes.join('')).toBe('# Notes\n');
    expect(loggedText()).not.toContain('{');
  });

  it('notes get prints nothing when there are no notes and output is piped', async () => {
    makeClient();
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as never);
    await run(['notes', 'get', 'm1']);
    expect(writes.join('')).toBe('');
    expect(loggedText()).toBe('');
  });

  it('notes set replaces the body', async () => {
    const { setNotes } = makeClient();
    await run(['notes', 'set', 'm1', 'fresh notes']);
    expect(setNotes).toHaveBeenCalledWith('m1', 'fresh notes');
  });

  it('notes set reads the body from a file', async () => {
    const { setNotes } = makeClient();
    const dir = mkdtempSync(join(tmpdir(), 'exp-cli-test-'));
    const file = join(dir, 'notes.md');
    writeFileSync(file, '# From file\n');
    await run(['notes', 'set', 'm1', '--file', file]);
    expect(setNotes).toHaveBeenCalledWith('m1', '# From file\n');
  });

  it('notes set without a body refuses before calling the API', async () => {
    const { setNotes } = makeClient();
    await expect(run(['notes', 'set', 'm1'])).rejects.toThrow();
    expect(setNotes).not.toHaveBeenCalled();
  });

  it('notes append adds a block', async () => {
    const { appendNotes } = makeClient();
    await run(['notes', 'append', 'm1', 'follow-up']);
    expect(appendNotes).toHaveBeenCalledWith('m1', 'follow-up');
  });
});

describe('meetings delete', () => {
  it('refuses with no ids and never calls the API', async () => {
    const { del, deleteMany } = makeClient();
    await expect(run(['delete'])).rejects.toThrow();
    expect(del).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('uses the single-id path for one id (precise errors)', async () => {
    const { del, deleteMany } = makeClient();
    await run(['delete', 'm1']);
    expect(del).toHaveBeenCalledWith('m1');
    expect(deleteMany).not.toHaveBeenCalled();
    expect(JSON.parse(loggedText())).toEqual({ requested: 1, count: 1 });
  });

  it('bulk-deletes multiple ids and reports the server count', async () => {
    const { del, deleteMany } = makeClient();
    deleteMany.mockResolvedValue({ count: 2 });
    await run(['delete', 'm1', 'm2', 'm3']);
    expect(del).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith(['m1', 'm2', 'm3']);
    expect(JSON.parse(loggedText())).toEqual({ requested: 3, count: 2 });
  });

  it('merges and dedupes ids from --ids-file with the args', async () => {
    const { deleteMany } = makeClient();
    deleteMany.mockResolvedValue({ count: 3 });
    const dir = mkdtempSync(join(tmpdir(), 'exp-cli-test-'));
    const file = join(dir, 'ids.txt');
    writeFileSync(file, 'm2\nm3\n\n m1 \n');
    await run(['delete', 'm1', '--ids-file', file]);
    expect(deleteMany).toHaveBeenCalledWith(['m1', 'm2', 'm3']);
  });
});

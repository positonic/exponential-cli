import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMeetingsCommand } from './meetings.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';

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
  const appendNotes = vi.fn().mockResolvedValue(makeMeeting('m1'));
  const client = {
    meetings: { list, get, create, update, getNotes, setNotes, appendNotes },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  return { list, get, create, update, getNotes, setNotes, appendNotes };
}

async function run(args: string[]) {
  const cmd = createMeetingsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
});

describe('meetings get', () => {
  it('fetches by id', async () => {
    const { get } = makeClient();
    await run(['get', 'm1']);
    expect(get).toHaveBeenCalledWith('m1');
  });
});

describe('meetings create', () => {
  it('requires a transcript', async () => {
    makeClient();
    const errorSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(
      run(['create', '--title', 'Standup', '--notes', 'n']),
    ).rejects.toThrow();
    errorSpy.mockRestore();
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
      meetingDate: new Date('2026-08-25'),
      projectId: undefined,
      workspaceId: undefined,
    });
  });
});

describe('meetings update', () => {
  it('passes only the provided fields', async () => {
    const { update } = makeClient();
    await run(['update', 'm1', '--notes', 'replaced']);
    expect(update).toHaveBeenCalledWith({
      id: 'm1',
      title: undefined,
      notes: 'replaced',
      summary: undefined,
      description: undefined,
      meetingDate: undefined,
    });
  });
});

describe('meetings notes', () => {
  it('notes get prints the raw body', async () => {
    const { getNotes } = makeClient();
    getNotes.mockResolvedValue('# Notes');
    await run(['notes', 'get', 'm1']);
    expect(getNotes).toHaveBeenCalledWith('m1');
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      JSON.stringify({ id: 'm1', notes: '# Notes' }, null, 2),
    );
  });

  it('notes set replaces the body', async () => {
    const { setNotes } = makeClient();
    await run(['notes', 'set', 'm1', 'fresh notes']);
    expect(setNotes).toHaveBeenCalledWith('m1', 'fresh notes');
  });

  it('notes append adds a block', async () => {
    const { appendNotes } = makeClient();
    await run(['notes', 'append', 'm1', 'follow-up']);
    expect(appendNotes).toHaveBeenCalledWith('m1', 'follow-up');
  });
});

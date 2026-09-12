import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTimeCommand, parseBatchFile, batchItemToInput, parseMessagesFile } from './time.js';
import { createActionsCommand } from './actions.js';
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

const START = new Date('2026-09-11T09:22:00');
const END = new Date('2026-09-11T10:30:00');

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    userId: 'owner',
    actionId: 'a1',
    workspaceId: 'ws1',
    startedAt: START,
    endedAt: END,
    source: 'claude-desktop',
    status: 'PROPOSED',
    sourceRef: 'claude-session:s1#0',
    note: 'PR 642',
    createdByAgentId: 'agent',
    action: { id: 'a1', name: 'Action modal close latency', projectId: null, workspaceId: 'ws1' },
    ...overrides,
  };
}

function makeClient() {
  const log = vi.fn().mockResolvedValue({ entry: makeEntry(), outcome: 'created' });
  const logBatch = vi.fn(async (entries: Array<Record<string, unknown>>) =>
    entries.map((e, index) => ({ index, success: true, outcome: 'created', sourceRef: e.sourceRef, entry: makeEntry(e) })),
  );
  const list = vi.fn().mockResolvedValue([makeEntry(), makeEntry({ id: 'e2', status: 'CONFIRMED', source: 'manual', sourceRef: null, note: null })]);
  const confirmDay = vi.fn().mockResolvedValue({ confirmed: 2 });
  const upsertBySource = vi.fn().mockResolvedValue({
    action: { id: 'a1', name: 'Action modal close latency', status: 'ACTIVE', priority: 'Quick', kanbanStatus: null, project: null },
    outcome: 'created',
  });
  const client = { time: { log, logBatch, list, confirmDay }, actions: { upsertBySource } };
  vi.mocked(clientModule.getClient).mockReturnValue(client as unknown as ReturnType<typeof clientModule.getClient>);
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  return { log, logBatch, list, confirmDay, upsertBySource };
}

async function run(args: string[], command = createTimeCommand) {
  const cmd = command();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

function loggedText(): string {
  return vi.mocked(console.log).mock.calls.map((c) => c.join(' ')).join('\n');
}

function writeTemp(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'exp-cli-time-'));
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
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

afterEach(() => {
  process.exitCode = 0;
});

describe('time log (single)', () => {
  it('logs one entry with the flags mapped to the SDK input', async () => {
    const { log } = makeClient();
    await run([
      'log', '--action', 'a1', '--from', '2026-09-11T09:22', '--to', '2026-09-11T10:30',
      '--source', 'claude-desktop', '--ref', 'claude-session:s1#0', '--note', 'PR 642',
    ]);
    expect(log).toHaveBeenCalledWith({
      actionId: 'a1',
      startedAt: new Date('2026-09-11T09:22'),
      endedAt: new Date('2026-09-11T10:30'),
      source: 'claude-desktop',
      status: undefined,
      sourceRef: 'claude-session:s1#0',
      note: 'PR 642',
    });
    const payload = JSON.parse(loggedText()) as { outcome: string; entry: { status: string; minutes: number } };
    expect(payload.outcome).toBe('created');
    expect(payload.entry.status).toBe('PROPOSED');
    expect(payload.entry.minutes).toBe(68);
  });

  it('rejects an unknown --source before calling the API', async () => {
    const { log } = makeClient();
    await expect(
      run(['log', '--action', 'a1', '--from', '2026-09-11T09:22', '--to', '2026-09-11T10:30', '--source', 'timer']),
    ).rejects.toThrow('process.exit(1)');
    expect(log).not.toHaveBeenCalled();
  });

  it('rejects --to at or before --from', async () => {
    const { log } = makeClient();
    await expect(
      run(['log', '--action', 'a1', '--from', '2026-09-11T10:30', '--to', '2026-09-11T09:22']),
    ).rejects.toThrow('process.exit(1)');
    expect(log).not.toHaveBeenCalled();
  });

  it('needs --action and both bounds', async () => {
    const { log } = makeClient();
    await expect(run(['log', '--from', '2026-09-11T09:22', '--to', '2026-09-11T10:30'])).rejects.toThrow('process.exit(1)');
    await expect(run(['log', '--action', 'a1', '--from', '2026-09-11T09:22'])).rejects.toThrow('process.exit(1)');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('time log --from-file', () => {
  it('parses a JSON array and rejects unknown keys naming the accepted ones', () => {
    expect(parseBatchFile('[{"actionId":"a1","from":"2026-09-11T09:22","to":"2026-09-11T10:30"}]')).toHaveLength(1);
    expect(parseBatchFile('{"entries":[{"ref":"r0"}]}')).toHaveLength(1);
    expect(() => parseBatchFile('[{"actionId":"a1","startAt":"x"}]')).toThrow(/unknown field\(s\): startAt\. Accepted: actionId, action, startedAt, from, endedAt, to, source, status, sourceRef, ref, note/);
    expect(() => parseBatchFile('[]')).toThrow('no entries');
    expect(() => parseBatchFile('{"nope":1}')).toThrow('JSON array of entries');
    expect(() => parseBatchFile('not json')).toThrow('--from-file must be JSON');
    expect(() => parseBatchFile('[1]')).toThrow('Entry[0] is not an object');
  });

  it('flags become defaults; per-entry values win', () => {
    const defaults = { actionId: 'a1', source: 'claude-desktop' as const, note: 'default note' };
    const input = batchItemToInput(
      { from: '2026-09-11T09:22', to: '2026-09-11T10:30', ref: 'r0', note: 'own note', action: 'a2' },
      0,
      defaults,
    );
    expect(input).toEqual({
      actionId: 'a2',
      startedAt: new Date('2026-09-11T09:22'),
      endedAt: new Date('2026-09-11T10:30'),
      source: 'claude-desktop',
      status: undefined,
      sourceRef: 'r0',
      note: 'own note',
    });
    expect(() => batchItemToInput({ from: '2026-09-11T09:22', to: '2026-09-11T10:30' }, 1, {})).toThrow('Entry[1] needs an "actionId"');
    expect(() => batchItemToInput({ actionId: 'a1', from: '2026-09-11T09:22' }, 2, {})).toThrow('Entry[2] needs "startedAt" and "endedAt"');
    expect(() => batchItemToInput({ actionId: 'a1', from: '2026-09-11T09:22', to: '2026-09-11T10:30', source: 'timer' }, 3, {})).toThrow('Invalid source');
  });

  it('logs each entry in order with the flag defaults and reports the batch', async () => {
    const { logBatch } = makeClient();
    const file = writeTemp('entries.json', JSON.stringify([
      { from: '2026-09-11T09:22', to: '2026-09-11T10:30', ref: 'claude-session:s1#0', note: 'PR 642' },
      { from: '2026-09-11T11:00', to: '2026-09-11T11:25', ref: 'claude-session:s1#1', actionId: 'a2' },
    ]));
    await run(['log', '--from-file', file, '--action', 'a1', '--source', 'claude-desktop']);

    expect(logBatch).toHaveBeenCalledTimes(2);
    expect(logBatch.mock.calls[0]?.[0]?.[0]).toMatchObject({ actionId: 'a1', source: 'claude-desktop', sourceRef: 'claude-session:s1#0', note: 'PR 642' });
    expect(logBatch.mock.calls[1]?.[0]?.[0]).toMatchObject({ actionId: 'a2', source: 'claude-desktop', sourceRef: 'claude-session:s1#1' });
    const payload = JSON.parse(loggedText()) as { total: number; succeeded: number; failed: number; results: { index: number; outcome: string }[] };
    expect(payload).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    expect(payload.results.map((r) => r.index)).toEqual([0, 1]);
    expect(process.exitCode).toBe(0);
  });

  it('a bad entry fails on its own and sets a non-zero exit code, the rest still log', async () => {
    const { logBatch } = makeClient();
    const file = writeTemp('entries.json', JSON.stringify([
      { from: '2026-09-11T09:22', to: '2026-09-11T10:30', ref: 'r0' },
      { from: '2026-09-11T11:00', ref: 'r1' },
    ]));
    await run(['log', '--from-file', file, '--action', 'a1']);
    expect(logBatch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(loggedText()) as { succeeded: number; failed: number; results: { error: string | null }[] };
    expect(payload).toMatchObject({ succeeded: 1, failed: 1 });
    expect(payload.results[1]?.error).toContain('needs "startedAt" and "endedAt"');
    expect(process.exitCode).toBe(1);
  });

  it('refuses a shared --ref with --from-file', async () => {
    const { logBatch } = makeClient();
    const file = writeTemp('entries.json', '[{"from":"2026-09-11T09:22","to":"2026-09-11T10:30"}]');
    await expect(run(['log', '--from-file', file, '--action', 'a1', '--ref', 'shared'])).rejects.toThrow('process.exit(1)');
    expect(logBatch).not.toHaveBeenCalled();
  });
});

describe('time list', () => {
  it('lists a day with status and totals', async () => {
    const { list } = makeClient();
    await run(['list', '--date', '2026-09-11']);
    expect(list).toHaveBeenCalledWith('2026-09-11', undefined);
    const payload = JSON.parse(loggedText()) as { date: string; total: number; proposed: number; totalMinutes: number; entries: { status: string }[] };
    expect(payload).toMatchObject({ date: '2026-09-11', total: 2, proposed: 1, totalMinutes: 136 });
    expect(payload.entries.map((e) => e.status)).toEqual(['PROPOSED', 'CONFIRMED']);
  });

  it('resolves --workspace and filters --proposed locally', async () => {
    const { list } = makeClient();
    await run(['list', '--date', '2026-09-11', '--workspace', 'syntrofi', '--proposed']);
    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalledWith(expect.anything(), 'syntrofi');
    expect(list).toHaveBeenCalledWith('2026-09-11', 'ws1');
    const payload = JSON.parse(loggedText()) as { total: number };
    expect(payload.total).toBe(1);
  });

  it('rejects a non YYYY-MM-DD date before calling the API', async () => {
    const { list } = makeClient();
    await expect(run(['list', '--date', 'yesterday'])).rejects.toThrow('process.exit(1)');
    expect(list).not.toHaveBeenCalled();
  });
});

describe('actions upsert', () => {
  it('upserts by source with the workspace resolved and links passed through', async () => {
    const { upsertBySource } = makeClient();
    await run([
      'upsert', '--source-type', 'claude-session', '--source-id', 's1', '-t', 'Action modal close latency',
      '--workspace', 'syntrofi', '--ticket', 't1',
    ], createActionsCommand);
    expect(upsertBySource).toHaveBeenCalledWith({
      sourceType: 'claude-session',
      sourceId: 's1',
      name: 'Action modal close latency',
      workspaceId: 'ws1',
      description: undefined,
      projectId: undefined,
      ticketId: 't1',
    });
    const payload = JSON.parse(loggedText()) as { outcome: string; action: { id: string } };
    expect(payload.outcome).toBe('created');
    expect(payload.action.id).toBe('a1');
  });
});

describe('time confirm', () => {
  it('confirms the day and prints the count', async () => {
    const { confirmDay } = makeClient();
    await run(['confirm', '--date', '2026-09-11']);
    expect(confirmDay).toHaveBeenCalledWith('2026-09-11', undefined);
    expect(JSON.parse(loggedText())).toEqual({ date: '2026-09-11', confirmed: 2 });
  });

  it('resolves --workspace and rejects a malformed date first', async () => {
    const { confirmDay } = makeClient();
    await run(['confirm', '--date', '2026-09-11', '--workspace', 'syntrofi']);
    expect(confirmDay).toHaveBeenCalledWith('2026-09-11', 'ws1');
    await expect(run(['confirm', '--date', 'today'])).rejects.toThrow('process.exit(1)');
    expect(confirmDay).toHaveBeenCalledTimes(1);
  });
});

describe('time log — V2 outcomes', () => {
  it('prints merged and dropped results without an entry', async () => {
    const { log } = makeClient();
    log.mockResolvedValueOnce({ entry: null, outcome: 'merged', pieces: [], mergedInto: ['manual-1'] });
    await run(['log', '--action', 'a1', '--from', '2026-09-11T14:57', '--to', '2026-09-11T15:22', '--ref', 'r']);
    expect(JSON.parse(loggedText())).toEqual({ outcome: 'merged', entry: null, pieces: [], mergedInto: ['manual-1'] });
  });
});

describe('time segment', () => {
  it('parses messages and rejects bad rows', () => {
    expect(parseMessagesFile('[{"at":"2026-09-11T09:00:00","role":"user"}]')).toHaveLength(1);
    expect(parseMessagesFile('{"messages":[{"at":"2026-09-11T09:00:00","role":"assistant"}]}')).toHaveLength(1);
    expect(() => parseMessagesFile('[{"at":"nope","role":"user"}]')).toThrow('not a valid timestamp');
    expect(() => parseMessagesFile('[{"at":"2026-09-11T09:00:00","role":"system"}]')).toThrow('role must be');
    expect(() => parseMessagesFile('{"x":1}')).toThrow('JSON array of {at, role}');
  });

  it('emits the batch time log --from-file consumes: claude-desktop for human segments, agent-run for unattended runs', async () => {
    makeClient();
    const file = writeTemp('messages.json', JSON.stringify([
      { at: '2026-09-11T10:00:00', role: 'user' },
      { at: '2026-09-11T10:05:00', role: 'assistant' },
      { at: '2026-09-11T10:20:00', role: 'assistant' },
      { at: '2026-09-11T10:31:00', role: 'assistant' },
      { at: '2026-09-11T11:00:00', role: 'assistant' },
      { at: '2026-09-11T12:00:00', role: 'assistant' },
      { at: '2026-09-11T12:05:00', role: 'user' },
      { at: '2026-09-11T12:06:00', role: 'assistant' },
    ]));
    await run(['segment', '--from-file', file, '--action', 'a1', '--ref-prefix', 'claude-session:s1', '--note', 'PR 660']);
    const batch = JSON.parse(loggedText()) as Array<{ actionId: string; source: string; sourceRef: string; startedAt: string; endedAt: string; note: string }>;
    expect(batch.map((b) => [b.source, b.sourceRef])).toEqual([
      ['claude-desktop', 'claude-session:s1#0'],
      ['agent-run', 'claude-session:s1#1'],
      ['claude-desktop', 'claude-session:s1#2'],
    ]);
    expect(batch.every((b) => b.actionId === 'a1' && b.note === 'PR 660')).toBe(true);
    expect(new Date(batch[0]!.startedAt)).toEqual(new Date('2026-09-11T10:00:00'));
    expect(new Date(batch[0]!.endedAt)).toEqual(new Date('2026-09-11T10:20:00'));
    expect(new Date(batch[1]!.startedAt)).toEqual(new Date('2026-09-11T10:30:00'));
    expect(new Date(batch[1]!.endedAt)).toEqual(new Date('2026-09-11T12:00:00'));
    // The batch round-trips through the log parser with no unknown keys.
    expect(parseBatchFile(loggedText())).toHaveLength(3);
  });

  it('rejects a non-positive --gap', async () => {
    makeClient();
    const file = writeTemp('messages.json', '[{"at":"2026-09-11T10:00:00","role":"user"}]');
    await expect(run(['segment', '--from-file', file, '--action', 'a1', '--ref-prefix', 'p', '--gap', '0'])).rejects.toThrow('process.exit(1)');
  });
});

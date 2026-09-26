import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { createActionsCommand, parseBlockedBy } from './actions.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';
import {
  blockedMarker,
  formatBlockerLine,
  printBlockedBy,
  outputActionsPretty,
  transformAction,
} from '../utils/output.js';
import type { Action, ActionDependencyEdge } from 'exponential-sdk';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: (e: unknown) => !!(e as { data?: unknown })?.data,
}));

vi.mock('../utils/resolve.js', () => ({
  resolveWorkspaceId: vi.fn(),
  resolveWorkspace: vi.fn(),
}));

// eslint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

const edge = (id: string, name: string, status: string): ActionDependencyEdge => ({
  id: `dep-${id}`,
  dependsOn: { id, name, status, kanbanStatus: null, projectId: null },
});

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'clxaction0000000000000001',
    name: 'Ship it',
    description: null,
    status: 'ACTIVE',
    priority: 'Quick',
    projectId: null,
    workspaceId: null,
    kanbanStatus: 'TODO',
    kanbanOrder: null,
    dueDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    duration: null,
    completedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    source: 'cli',
    ...overrides,
  };
}

const BLOCKED = makeAction({
  depsOut: [edge('clxblockera00000000000001', 'Write spec', 'ACTIVE'), edge('clxblockerb00000000000002', 'Old one', 'COMPLETED')],
  openBlockerCount: 1,
  isBlocked: true,
});

function makeClient() {
  const update = vi.fn().mockResolvedValue(makeAction());
  const create = vi.fn().mockResolvedValue(makeAction());
  const get = vi.fn().mockResolvedValue(BLOCKED);
  const searchForDependencies = vi.fn().mockResolvedValue([
    { id: 'clxcand0000000000000000001', name: 'Candidate', status: 'ACTIVE', kanbanStatus: 'TODO', projectId: null },
  ]);
  const client = { actions: { update, create, get, searchForDependencies } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  return { update, create, get, searchForDependencies };
}

async function run(args: string[]) {
  // Mount under a root that carries the global output flags, as program.ts does.
  const root = new Command().option('--json').option('--pretty').exitOverride();
  root.addCommand(createActionsCommand());
  await root.parseAsync(['actions', ...args], { from: 'user' });
}

function logged(): string {
  return vi.mocked(console.log).mock.calls.map((c) => strip(String(c[0] ?? ''))).join('\n');
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
});

describe('parseBlockedBy', () => {
  it('leaves the set alone when neither flag is given', () => {
    expect(parseBlockedBy(undefined, undefined)).toBeUndefined();
  });
  it('sends an empty set for --clear-blocked-by', () => {
    expect(parseBlockedBy(undefined, true)).toEqual([]);
  });
  it('splits and trims a comma list', () => {
    expect(parseBlockedBy(' a, b ,,c', undefined)).toEqual(['a', 'b', 'c']);
  });
  it('refuses both flags together and an empty list', () => {
    expect(() => parseBlockedBy('a', true)).toThrow(/not both/);
    expect(() => parseBlockedBy(' , ', undefined)).toThrow(/No blocker IDs/);
  });
});

describe('rendering blocked state', () => {
  it('blockedMarker shows the count only above one open blocker', () => {
    expect(strip(blockedMarker({ isBlocked: true, openBlockerCount: 1 }))).toBe('[BLOCKED]');
    expect(strip(blockedMarker({ isBlocked: true, openBlockerCount: 3 }))).toBe('[BLOCKED ×3]');
    expect(blockedMarker({ isBlocked: false, openBlockerCount: 0 })).toBe('');
    expect(blockedMarker({})).toBe('');
  });

  it('formatBlockerLine prints name, short id and status', () => {
    const line = strip(formatBlockerLine({ id: 'clxblockera00000000000001', name: 'Write spec', status: 'ACTIVE', kanbanStatus: null, projectId: null }));
    expect(line).toBe('Write spec (00000001) ACTIVE');
  });

  it('printBlockedBy lists every blocker with open/total and is silent without the relation', () => {
    printBlockedBy(BLOCKED);
    const out = logged();
    expect(out).toContain('Blocked by: (1 open of 2)');
    expect(out).toContain('Write spec (00000001) ACTIVE');
    expect(out).toContain('Old one (00000002) COMPLETED');

    vi.mocked(console.log).mockClear();
    printBlockedBy(makeAction());
    expect(console.log).not.toHaveBeenCalled();
  });

  it('list rows carry the blocked marker', () => {
    outputActionsPretty([BLOCKED, makeAction({ id: 'other', name: 'Free', isBlocked: false, openBlockerCount: 0, depsOut: [] })]);
    const out = logged();
    expect(out).toContain('[TODO] [BLOCKED] Ship it');
    expect(out).toContain('[TODO] Free');
  });

  it('transformAction passes depsOut, openBlockerCount and isBlocked through unchanged, and omits them when absent', () => {
    const json = transformAction(BLOCKED);
    expect(json.depsOut).toBe(BLOCKED.depsOut);
    expect(json.openBlockerCount).toBe(1);
    expect(json.isBlocked).toBe(true);
    expect(json).not.toHaveProperty('blockedByIds');
    expect(json).not.toHaveProperty('blockingIds');

    const bare = transformAction(makeAction());
    expect(bare).not.toHaveProperty('depsOut');
    expect(bare).not.toHaveProperty('isBlocked');
  });
});

describe('actions show', () => {
  it('reads via getById and prints the Blocked by block', async () => {
    const { get } = makeClient();
    await run(['show', 'clxaction0000000000000001', '--pretty']);
    expect(get).toHaveBeenCalledWith('clxaction0000000000000001');
    expect(logged()).toContain('Blocked by:');
  });

  it('emits the dependency fields in JSON', async () => {
    makeClient();
    await run(['show', 'clxaction0000000000000001', '--json']);
    const parsed = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
    expect(parsed.isBlocked).toBe(true);
    expect(parsed.openBlockerCount).toBe(1);
    expect(parsed.depsOut).toHaveLength(2);
  });
});

describe('actions update --blocked-by', () => {
  it('replaces the set with the positional id and re-reads the action', async () => {
    const { update, get } = makeClient();
    await run(['update', 'clxaction0000000000000001', '--blocked-by', 'a,b', '--json']);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'clxaction0000000000000001', blockedByIds: ['a', 'b'] }));
    expect(get).toHaveBeenCalledWith('clxaction0000000000000001');
  });

  it('--clear-blocked-by sends an empty array; --id is still accepted', async () => {
    const { update } = makeClient();
    await run(['update', '--id', 'clxaction0000000000000001', '--clear-blocked-by', '--json']);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'clxaction0000000000000001', blockedByIds: [] }));
  });

  it('omits blockedByIds when neither flag is given and does not re-read', async () => {
    const { update, get } = makeClient();
    await run(['update', 'clxaction0000000000000001', '-n', 'Renamed', '--json']);
    const arg = update.mock.calls[0]![0] as { blockedByIds?: string[] };
    expect(arg.blockedByIds).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('surfaces the server BAD_REQUEST message verbatim on a cycle', async () => {
    const { update } = makeClient();
    const err = Object.assign(new Error('This would create a dependency cycle.'), { data: { code: 'BAD_REQUEST' } });
    update.mockRejectedValueOnce(err);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await run(['update', 'clxaction0000000000000001', '--blocked-by', 'a', '--json']);

    const out = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
    expect(out.error.code).toBe('BAD_REQUEST');
    expect(out.error.message).toBe('This would create a dependency cycle.');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('explains a NOT_FOUND blocker id instead of the generic message', async () => {
    const { update } = makeClient();
    const err = Object.assign(new Error('Blocking action not found in this workspace'), { data: { code: 'NOT_FOUND' } });
    update.mockRejectedValueOnce(err);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await run(['update', 'clxaction0000000000000001', '--blocked-by', 'nope', '--json']);

    const out = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
    expect(out.error.message).toBe('Blocking action not found in this workspace');
    expect(out.error.suggestion).toContain('action CUIDs');
  });
});

describe('actions create --blocked-by', () => {
  it('passes the ids to action.create', async () => {
    const { create } = makeClient();
    await run(['create', '-n', 'New', '--blocked-by', 'a, b', '--json']);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', blockedByIds: ['a', 'b'] }));
  });
});

describe('actions deps search', () => {
  it('resolves the workspace and forwards the picker options', async () => {
    const { searchForDependencies } = makeClient();
    await run(['deps', 'search', 'cand', '--workspace', 'clear', '--exclude', 'x', '--limit', '5', '--json']);
    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalledWith(expect.anything(), 'clear');
    expect(searchForDependencies).toHaveBeenCalledWith({ query: 'cand', workspaceId: 'ws1', excludeId: 'x', limit: 5 });
    const parsed = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
    expect(parsed.actions[0].id).toBe('clxcand0000000000000000001');
    expect(parsed.total).toBe(1);
  });

  it('sends no workspaceId when --workspace is omitted', async () => {
    const { searchForDependencies } = makeClient();
    await run(['deps', 'search', 'cand', '--json']);
    expect(resolveModule.resolveWorkspaceId).not.toHaveBeenCalled();
    expect(searchForDependencies.mock.calls[0]![0]).toMatchObject({ query: 'cand', workspaceId: undefined });
  });
});

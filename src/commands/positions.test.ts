import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPositionsCommand, parseImportFile, pickPosition } from './positions.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';
import { resetStdinGuardForTests } from '../utils/input.js';

vi.mock('../client/index.js', () => ({ getClient: vi.fn(), isTRPCError: () => false }));
vi.mock('../utils/resolve.js', () => ({ resolveWorkspaceId: vi.fn() }));

const members = [
  { id: 'u1', name: 'James Farrell', email: 'james@x.io', image: null, role: 'owner', teamRole: null, source: 'workspace', teams: [], mentionSyntax: '' },
  { id: 'u2', name: 'Andi Stanner', email: 'andi@x.io', image: null, role: 'admin', teamRole: null, source: 'workspace', teams: [], mentionSyntax: '' },
] as const;

const cto = {
  id: 'p1',
  title: 'Technical Director',
  remit: 'Tech',
  notAccountableFor: null,
  holders: [{ userId: 'u1', name: 'James Farrell', image: null, isAgent: false }],
};

let api: Record<string, ReturnType<typeof vi.fn>>;

async function run(args: string[]) {
  const cmd = createPositionsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
  resetStdinGuardForTests();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  api = {
    list: vi.fn().mockResolvedValue({ positions: [cto], members: [] }),
    create: vi.fn().mockResolvedValue(cto),
    update: vi.fn().mockResolvedValue(cto),
    delete: vi.fn().mockResolvedValue({ id: 'p1' }),
    setHolders: vi.fn().mockResolvedValue(cto),
    importMany: vi.fn().mockResolvedValue({ written: false, results: [] }),
    listMembers: vi.fn().mockResolvedValue(members),
  };
  vi.mocked(clientModule.getClient).mockReturnValue({
    positions: api,
    workspaces: { listMembers: api.listMembers },
  } as never);
});

afterEach(() => vi.restoreAllMocks());

describe('pickPosition', () => {
  it('matches id or case-insensitive title, and lists titles on a miss', () => {
    expect(pickPosition([cto], 'p1')).toBe(cto);
    expect(pickPosition([cto], 'technical director')).toBe(cto);
    expect(() => pickPosition([cto], 'CFO')).toThrow(/"Technical Director"/);
  });
});

describe('positions commands', () => {
  it('create resolves holders by name', async () => {
    await run(['create', '-t', 'CTO', '-r', 'Tech', '--holder', 'andi', '--holder', 'james@x.io']);
    expect(api.create).toHaveBeenCalledWith({ workspaceId: 'ws1', title: 'CTO', remit: 'Tech', holderUserIds: ['u2', 'u1'] });
  });

  it('update by title sends only what changed', async () => {
    await run(['update', 'technical director', '--remit', 'New', '--clear-not-accountable-for']);
    expect(api.update).toHaveBeenCalledWith({ workspaceId: 'ws1', positionId: 'p1', remit: 'New', notAccountableFor: null });
  });

  it('update --no-holders clears the holder set', async () => {
    await run(['update', 'p1', '--no-holders']);
    expect(api.update).toHaveBeenCalledWith({ workspaceId: 'ws1', positionId: 'p1', holderUserIds: [] });
  });

  it('holders add/remove compute from the current set', async () => {
    await run(['holders', 'add', 'p1', 'andi']);
    expect(api.setHolders).toHaveBeenLastCalledWith('ws1', 'p1', ['u1', 'u2']);
    await run(['holders', 'remove', 'p1', 'james']);
    expect(api.setHolders).toHaveBeenLastCalledWith('ws1', 'p1', []);
  });

  it('delete resolves the title first', async () => {
    await run(['delete', 'Technical Director']);
    expect(api.delete).toHaveBeenCalledWith('ws1', 'p1');
  });

  it('import --dry-run maps holder names to ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exp-pos-'));
    const file = join(dir, 'roles.json');
    writeFileSync(file, JSON.stringify([{ title: 'PM', remit: 'Product', holders: ['Andi Stanner'] }]));
    await run(['import', file, '--dry-run']);
    expect(api.importMany).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      dryRun: true,
      positions: [{ title: 'PM', remit: 'Product', holderUserIds: ['u2'] }],
    });
  });
});

describe('parseImportFile', () => {
  it('accepts {positions: [...]} and rejects a row without a remit', () => {
    expect(parseImportFile('{"positions":[{"title":"A","remit":"B"}]}', [...members] as never)).toEqual([
      { title: 'A', remit: 'B', holderUserIds: [] },
    ]);
    expect(() => parseImportFile('[{"title":"A"}]', [] as never)).toThrow(/remit/);
  });
});

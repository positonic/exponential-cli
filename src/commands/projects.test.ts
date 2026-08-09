import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { createProjectsCommand } from './projects.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'KR support',
    description: null,
    status: 'ACTIVE',
    priority: 'NONE',
    workspaceId: 'ws1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeClient(options: { project?: Record<string, unknown> } = {}) {
  const calls = {
    list: vi.fn().mockResolvedValue([makeProject()]),
    get: vi.fn().mockResolvedValue(options.project ?? makeProject()),
    update: vi.fn().mockResolvedValue(makeProject()),
    deleteProject: vi.fn().mockResolvedValue(makeProject()),
    workspaceList: vi
      .fn()
      .mockResolvedValue([{ id: 'ws1', slug: 'clear', name: 'CLEAR' }]),
  };
  const client = {
    projects: {
      list: calls.list,
      get: calls.get,
      update: calls.update,
      delete: calls.deleteProject,
    },
    workspaces: { list: calls.workspaceList },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return calls;
}

async function run(args: string[]) {
  const cmd = createProjectsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

function jsonFromLog(log: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const line = (log.mock.calls as unknown[][])
    .map((c) => String(c[0]))
    .find((s) => s.trim().startsWith('{'));
  expect(line, 'expected a JSON object on stdout').toBeDefined();
  return JSON.parse(line!) as Record<string, unknown>;
}

const originalExitCode = process.exitCode;
let exit: MockInstance<typeof process.exit>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = originalExitCode;
});

describe('projects list', () => {
  // `features list --workspace` has always taken a slug; this one used to demand
  // a raw CUID. Both now go through the same resolver.
  it('accepts a workspace slug', async () => {
    const calls = makeClient();

    await run(['list', '--workspace', 'clear']);

    expect(calls.list).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      includeActions: undefined,
    });
  });

  it('accepts a raw workspace id too', async () => {
    const calls = makeClient();

    await run(['list', '--workspace', 'ws1']);

    expect(calls.list).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      includeActions: undefined,
    });
  });

  it('lists across every workspace when none is named', async () => {
    const calls = makeClient();

    await run(['list']);

    expect(calls.workspaceList).not.toHaveBeenCalled();
    expect(calls.list).toHaveBeenCalledWith({
      workspaceId: undefined,
      includeActions: undefined,
    });
  });
});

describe('projects get', () => {
  it('fetches by id, slug or the compound app-URL form', async () => {
    const calls = makeClient();

    await run(['get', 'kr-support-cmjoko5550000rz03x4eqvycy']);

    expect(calls.get).toHaveBeenCalledWith('kr-support-cmjoko5550000rz03x4eqvycy');
  });

  // `project.getById` returns no `workspace` relation, so the detail JSON has
  // to carry the id itself — a bare `workspace: null` reads as "personal
  // project" to anything parsing this output.
  it('reports which workspace the project belongs to', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['get', 'p1']);

    expect(jsonFromLog(log).workspaceId).toBe('ws1');
  });

  it('surfaces the OKR edges the list read omits', async () => {
    makeClient({
      project: makeProject({
        goals: [{ id: 46, title: 'Ship the CLI' }],
        keyResults: [
          { keyResultId: 'kr1', keyResult: { id: 'kr1', title: 'Agents', goal: { id: 46, title: 'Ship the CLI' } } },
        ],
      }),
    });
    const log = vi.spyOn(console, 'log');

    await run(['get', 'p1']);

    const out = jsonFromLog(log);
    expect(out.goals).toEqual([{ id: 46, title: 'Ship the CLI' }]);
    expect(out.keyResults).toEqual([
      { id: 'kr1', title: 'Agents', goal: { id: 46, title: 'Ship the CLI' } },
    ]);
  });
});

describe('projects update', () => {
  it('sends only the fields named — the SDK fills the required rest', async () => {
    const calls = makeClient();

    await run(['update', '--id', 'p1', '--name', 'Renamed']);

    const sent = calls.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: 'p1', name: 'Renamed' });
    expect(sent.status).toBeUndefined();
    expect(sent.priority).toBeUndefined();
    expect(sent.productId).toBeUndefined();
  });

  it('"none" unlinks the product', async () => {
    const calls = makeClient();

    await run(['update', '--id', 'p1', '--product', 'none']);

    expect(
      (calls.update.mock.calls[0]![0] as Record<string, unknown>).productId,
    ).toBeNull();
  });

  it('rejects a status the server would not accept', async () => {
    const calls = makeClient();

    await run(['update', '--id', 'p1', '--status', 'DONE']);

    expect(calls.update).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('projects delete', () => {
  it('deletes an empty placeholder project', async () => {
    const calls = makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['delete', '--id', 'p1']);

    expect(calls.deleteProject).toHaveBeenCalledWith('p1');
    expect(jsonFromLog(log)).toMatchObject({ deleted: true, id: 'p1' });
  });

  it('refuses while actions or OKR links would go with it', async () => {
    const calls = makeClient({
      project: makeProject({
        actions: [{ id: 'a1', name: 'Do it', status: 'ACTIVE' }],
        keyResults: [{ keyResultId: 'kr1' }],
      }),
    });
    const log = vi.spyOn(console, 'log');

    await run(['delete', '--id', 'p1']);

    expect(calls.deleteProject).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    const out = jsonFromLog(log);
    expect(out).toMatchObject({ deleted: false, id: 'p1' });
    expect(String(out.reason)).toContain('1 action(s)');
    expect(String(out.reason)).toContain('1 key result link(s)');
  });

  it('--force deletes anyway and reports the damage', async () => {
    const calls = makeClient({
      project: makeProject({
        actions: [{ id: 'a1', name: 'Do it', status: 'ACTIVE' }],
      }),
    });
    const log = vi.spyOn(console, 'log');

    await run(['delete', '--id', 'p1', '--force']);

    expect(calls.deleteProject).toHaveBeenCalledWith('p1');
    expect(jsonFromLog(log)).toMatchObject({ deleted: true, actionsDeleted: 1 });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { createGoalsCommand } from './goals.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

function makeGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: 46,
    title: 'Ship the CLI',
    description: null,
    status: 'active',
    period: 'Q3-2026',
    health: 'on-track',
    lifeDomainId: null,
    userId: 'u1',
    driUserId: null,
    workspaceId: 'ws1',
    parentGoalId: null,
    dueDate: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeKeyResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'kr1',
    goalId: 46,
    title: 'Weekly active agents',
    description: null,
    status: 'on-track',
    startValue: 0,
    currentValue: 20,
    targetValue: 100,
    unit: 'count',
    period: 'Q3-2026',
    userId: 'u1',
    driUserId: null,
    workspaceId: 'ws1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeClient(options: {
  goal?: Record<string, unknown>;
  goals?: Record<string, unknown>[];
  keyResults?: Record<string, unknown>[];
} = {}) {
  const calls = {
    list: vi.fn().mockResolvedValue(options.goals ?? [makeGoal()]),
    tree: vi.fn().mockResolvedValue(options.goals ?? [makeGoal()]),
    get: vi.fn().mockResolvedValue(options.goal ?? makeGoal()),
    create: vi.fn().mockResolvedValue(makeGoal()),
    update: vi.fn().mockResolvedValue(makeGoal()),
    setStatus: vi.fn().mockResolvedValue(makeGoal({ status: 'completed' })),
    setParent: vi.fn().mockResolvedValue(makeGoal()),
    deleteGoal: vi.fn().mockResolvedValue(makeGoal()),
    periods: vi.fn().mockResolvedValue([]),
    stats: vi.fn().mockResolvedValue({}),
    krList: vi.fn().mockResolvedValue(options.keyResults ?? [makeKeyResult()]),
    krGet: vi.fn().mockResolvedValue(makeKeyResult()),
    krCreate: vi.fn().mockResolvedValue(makeKeyResult()),
    krUpdate: vi.fn().mockResolvedValue(makeKeyResult()),
    krCheckIn: vi.fn().mockResolvedValue({
      id: 'ci1',
      keyResultId: 'kr1',
      previousValue: 20,
      newValue: 40,
      notes: null,
      createdById: 'u1',
      createdAt: new Date('2026-01-02'),
    }),
    krDelete: vi.fn().mockResolvedValue({ success: true }),
    linkProject: vi.fn().mockResolvedValue({ success: true }),
    linkFeature: vi.fn().mockResolvedValue({ success: true }),
    unlinkProject: vi.fn().mockResolvedValue({ success: true }),
    unlinkFeature: vi.fn().mockResolvedValue({ success: true }),
    workspaceList: vi
      .fn()
      .mockResolvedValue([{ id: 'ws1', slug: 'clear', name: 'CLEAR' }]),
  };

  const client = {
    goals: {
      list: calls.list,
      tree: calls.tree,
      get: calls.get,
      create: calls.create,
      update: calls.update,
      setStatus: calls.setStatus,
      setParent: calls.setParent,
      delete: calls.deleteGoal,
      periods: calls.periods,
      stats: calls.stats,
    },
    keyResults: {
      list: calls.krList,
      get: calls.krGet,
      create: calls.krCreate,
      update: calls.krUpdate,
      checkIn: calls.krCheckIn,
      delete: calls.krDelete,
      linkProject: calls.linkProject,
      linkFeature: calls.linkFeature,
      unlinkProject: calls.unlinkProject,
      unlinkFeature: calls.unlinkFeature,
    },
    workspaces: { list: calls.workspaceList },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return calls;
}

// Run args as if typed after `exponential goals`.
async function run(args: string[]) {
  const cmd = createGoalsCommand();
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

/**
 * `handleError` ends the process, so every failure path has to run against a
 * stubbed exit — otherwise the first bad-input test takes the suite with it.
 */
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

describe('goals list', () => {
  it('resolves a workspace slug and passes the filters through', async () => {
    const calls = makeClient();

    await run(['list', '--workspace', 'clear', '--period', 'Q3-2026', '--status', 'active']);

    expect(calls.list).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      period: 'Q3-2026',
      status: 'active',
    });
  });

  it('--tree reads the cascade instead of the flat list', async () => {
    const calls = makeClient();

    await run(['list', '--workspace', 'clear', '--tree']);

    expect(calls.tree).toHaveBeenCalledWith({ workspaceId: 'ws1', status: undefined });
    expect(calls.list).not.toHaveBeenCalled();
  });

  it('--mine drops the workspace scope so personal goals show up', async () => {
    const calls = makeClient();

    await run(['list', '--mine']);

    expect(calls.workspaceList).not.toHaveBeenCalled();
    expect(calls.list).toHaveBeenCalledWith({
      workspaceId: undefined,
      period: undefined,
      status: undefined,
    });
  });

  it('rejects a status the server would not accept', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['list', '--workspace', 'clear', '--status', 'done']);

    expect(JSON.stringify(jsonFromLog(log))).toContain('Invalid goal status');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('goals update', () => {
  // The incident this command exists to prevent: a title-only update that also
  // nulled `period` and `workspaceId`, orphaning the goal out of its workspace.
  it('sends only the fields named on the command line', async () => {
    const calls = makeClient();

    await run(['update', '--id', '46', '--title', 'Renamed']);

    const sent = calls.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.id).toBe(46);
    expect(sent.title).toBe('Renamed');
    expect(sent.period).toBeUndefined();
    expect(sent.workspaceId).toBeUndefined();
    expect(sent.description).toBeUndefined();
    expect(sent.status).toBeUndefined();
  });

  it('treats "none" as an explicit clear', async () => {
    const calls = makeClient();

    await run(['update', '--id', '46', '--period', 'none', '--description', 'none']);

    const sent = calls.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.period).toBeNull();
    expect(sent.description).toBeNull();
  });

  it('--workspace none makes the objective personal, a slug re-homes it', async () => {
    const calls = makeClient();

    await run(['update', '--id', '46', '--workspace', 'none']);
    expect(
      (calls.update.mock.calls[0]![0] as Record<string, unknown>).workspaceId,
    ).toBeNull();

    await run(['update', '--id', '46', '--workspace', 'clear']);
    expect(
      (calls.update.mock.calls[1]![0] as Record<string, unknown>).workspaceId,
    ).toBe('ws1');
  });

  it('points on-hold at set-status rather than silently failing', async () => {
    const calls = makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['update', '--id', '46', '--status', 'on-hold']);

    expect(calls.update).not.toHaveBeenCalled();
    expect(JSON.stringify(jsonFromLog(log))).toContain('set-status');
  });

  it('rejects a non-numeric id before touching the API', async () => {
    const calls = makeClient();

    await run(['update', '--id', 'abc', '--title', 'Renamed']);

    expect(calls.update).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('goals set-status and close', () => {
  it('set-status writes only the status column', async () => {
    const calls = makeClient();

    await run(['set-status', '--id', '46', '--status', 'on-hold']);

    expect(calls.setStatus).toHaveBeenCalledWith({ id: 46, status: 'on-hold' });
    expect(calls.update).not.toHaveBeenCalled();
  });

  it('close defaults to completed and never routes through update', async () => {
    const calls = makeClient();

    await run(['close', '--id', '46']);

    expect(calls.setStatus).toHaveBeenCalledWith({ id: 46, status: 'completed' });
    expect(calls.update).not.toHaveBeenCalled();
  });

  it('close --status archived is allowed; anything else is refused', async () => {
    const calls = makeClient();

    await run(['close', '--id', '46', '--status', 'archived']);
    expect(calls.setStatus).toHaveBeenCalledWith({ id: 46, status: 'archived' });

    await run(['close', '--id', '46', '--status', 'active']);
    expect(calls.setStatus).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('goals reparent', () => {
  it('uses the single-column re-parent, not update', async () => {
    const calls = makeClient();

    await run(['reparent', '--id', '47', '--parent', '46']);

    expect(calls.setParent).toHaveBeenCalledWith({ id: 47, parentGoalId: 46 });
    expect(calls.update).not.toHaveBeenCalled();
  });

  it('detaches with --parent none', async () => {
    const calls = makeClient();

    await run(['reparent', '--id', '47', '--parent', 'none']);

    expect(calls.setParent).toHaveBeenCalledWith({ id: 47, parentGoalId: null });
  });
});

describe('goals delete', () => {
  it('deletes an objective with no key results', async () => {
    const calls = makeClient({ goal: makeGoal({ keyResults: [] }) });
    const log = vi.spyOn(console, 'log');

    await run(['delete', '--id', '46']);

    expect(calls.deleteGoal).toHaveBeenCalledWith(46);
    expect(jsonFromLog(log)).toMatchObject({ deleted: true, id: 46 });
  });

  it('refuses while key results would cascade away with it', async () => {
    const calls = makeClient({
      goal: makeGoal({ keyResults: [{ id: 'kr1' }, { id: 'kr2' }] }),
    });
    const log = vi.spyOn(console, 'log');

    await run(['delete', '--id', '46']);

    expect(calls.deleteGoal).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(jsonFromLog(log)).toMatchObject({
      deleted: false,
      id: 46,
      reason: 'has 2 key result(s)',
    });
  });

  it('--with-key-results goes ahead and reports what went with it', async () => {
    const calls = makeClient({
      goal: makeGoal({
        keyResults: [{ id: 'kr1' }],
        childGoals: [{ id: 47, title: 'Sub', status: 'active', health: null }],
      }),
    });
    const log = vi.spyOn(console, 'log');

    await run(['delete', '--id', '46', '--with-key-results']);

    expect(calls.deleteGoal).toHaveBeenCalledWith(46);
    const out = jsonFromLog(log);
    expect(out).toMatchObject({ deleted: true, id: 46 });
    expect(out.keyResultsDeleted).toHaveLength(1);
    expect(out.childGoalsDetached).toHaveLength(1);
  });
});

describe('goals kr', () => {
  // An unscoped okr.getAll is owner-scoped server-side, so a colleague's key
  // results on your objective would silently vanish from the list.
  it('borrows the objective\'s workspace so every member\'s key results show', async () => {
    const calls = makeClient();

    await run(['kr', 'list', '--goal', '46']);

    expect(calls.get).toHaveBeenCalledWith(46);
    expect(calls.krList).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      goalId: 46,
      period: undefined,
      status: undefined,
      onlyMine: undefined,
    });
  });

  it('lists workspace-wide when given a slug', async () => {
    const calls = makeClient();

    await run(['kr', 'list', '--workspace', 'clear', '--status', 'at-risk']);

    expect(calls.krList).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      goalId: undefined,
      period: undefined,
      status: 'at-risk',
      onlyMine: undefined,
    });
  });

  it('create inherits the objective\'s period when none is given', async () => {
    const calls = makeClient();

    await run(['kr', 'create', '--goal', '46', '--title', 'Signups', '--target', '500']);

    expect(calls.get).toHaveBeenCalledWith(46);
    expect(calls.krCreate).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 46, targetValue: 500, period: 'Q3-2026' }),
    );
  });

  it('create asks for --period when the objective has none', async () => {
    const calls = makeClient({ goal: makeGoal({ period: null }) });
    const log = vi.spyOn(console, 'log');

    await run(['kr', 'create', '--goal', '46', '--title', 'Signups', '--target', '500']);

    expect(calls.krCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(jsonFromLog(log))).toContain('--period');
  });

  it('update sends only what was named', async () => {
    const calls = makeClient();

    await run(['kr', 'update', '--id', 'kr1', '--current', '40']);

    const sent = calls.krUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: 'kr1', currentValue: 40 });
    expect(sent.targetValue).toBeUndefined();
    expect(sent.status).toBeUndefined();
  });

  it('checkin records a value and a note', async () => {
    const calls = makeClient();

    await run(['kr', 'checkin', '--id', 'kr1', '--value', '40', '--note', 'shipped v2']);

    expect(calls.krCheckIn).toHaveBeenCalledWith({
      id: 'kr1',
      value: 40,
      note: 'shipped v2',
    });
  });

  it('rejects a non-numeric value', async () => {
    const calls = makeClient();

    await run(['kr', 'checkin', '--id', 'kr1', '--value', 'lots']);

    expect(calls.krCheckIn).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('links a project and a feature', async () => {
    const calls = makeClient();

    await run(['kr', 'link', '--id', 'kr1', '--project', 'p1']);
    expect(calls.linkProject).toHaveBeenCalledWith({
      keyResultId: 'kr1',
      projectId: 'p1',
    });

    await run(['kr', 'link', '--id', 'kr1', '--feature', 'f1']);
    expect(calls.linkFeature).toHaveBeenCalledWith({
      keyResultId: 'kr1',
      featureId: 'f1',
    });
  });

  it('link with neither target explains what it wants', async () => {
    const calls = makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['kr', 'link', '--id', 'kr1']);

    expect(calls.linkProject).not.toHaveBeenCalled();
    expect(JSON.stringify(jsonFromLog(log))).toContain('--project');
  });

  it('unlinks a feature', async () => {
    const calls = makeClient();

    await run(['kr', 'unlink', '--id', 'kr1', '--feature', 'f1']);

    expect(calls.unlinkFeature).toHaveBeenCalledWith({
      keyResultId: 'kr1',
      featureId: 'f1',
    });
  });
});

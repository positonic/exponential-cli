import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGoalsCommand, createOkrsCommand } from './goals.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

vi.mock('../utils/resolve.js', () => ({
  resolveWorkspaceId: vi.fn(),
  resolveProductId: vi.fn(),
}));

function makeGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: 46,
    title: 'Ship OKR support',
    description: null,
    status: 'active',
    period: 'Q3-2026',
    health: 'on-track',
    dueDate: null,
    workspaceId: 'ws1',
    parentGoalId: null,
    driUserId: 'u1',
    userId: 'u1',
    lifeDomainId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeKeyResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clkr1',
    goalId: 46,
    title: 'Weekly active teams 40 → 120',
    description: null,
    status: 'on-track',
    startValue: 40,
    currentValue: 90,
    targetValue: 120,
    unit: 'count',
    period: 'Q3-2026',
    userId: 'u1',
    driUserId: 'u1',
    workspaceId: 'ws1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeClient(overrides: { goal?: Record<string, unknown> } = {}) {
  const goals = {
    list: vi.fn().mockResolvedValue([makeGoal()]),
    tree: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(overrides.goal ?? makeGoal()),
    create: vi.fn().mockResolvedValue(makeGoal()),
    update: vi.fn().mockResolvedValue(makeGoal()),
    setStatus: vi.fn().mockResolvedValue(makeGoal({ status: 'completed' })),
    setParent: vi.fn().mockResolvedValue(makeGoal({ parentGoalId: 15 })),
    delete: vi.fn().mockResolvedValue(makeGoal()),
    periods: vi.fn().mockResolvedValue([{ value: 'Q3-2026', label: 'Q3 2026' }]),
    stats: vi.fn().mockResolvedValue({
      totalObjectives: 3,
      totalKeyResults: 7,
      completedKeyResults: 2,
      statusBreakdown: { onTrack: 3, atRisk: 1, offTrack: 1, achieved: 2 },
      averageProgress: 61,
      averageConfidence: null,
      periodEndDate: null,
    }),
    keyResults: {
      list: vi.fn().mockResolvedValue([makeKeyResult()]),
      byObjective: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(makeKeyResult()),
      create: vi.fn().mockResolvedValue(makeKeyResult()),
      update: vi.fn().mockResolvedValue(makeKeyResult()),
      checkIn: vi.fn().mockResolvedValue({
        id: 'ci1',
        keyResultId: 'clkr1',
        previousValue: 40,
        newValue: 90,
        notes: null,
        createdAt: new Date('2026-01-01'),
      }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      linkProject: vi.fn().mockResolvedValue({ success: true }),
      unlinkProject: vi.fn().mockResolvedValue({ success: true }),
      linkFeature: vi.fn().mockResolvedValue({ success: true }),
      unlinkFeature: vi.fn().mockResolvedValue({ success: true }),
    },
  };
  const client = { goals };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  return goals;
}

// Run args as if typed after `exponential goals`.
async function run(args: string[]) {
  const cmd = createGoalsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

// Run args as if typed after `exponential okrs`.
async function runOkrs(args: string[]) {
  const cmd = createOkrsCommand();
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = originalExitCode;
});

describe('goals list', () => {
  it('resolves a workspace slug and forwards the filters', async () => {
    const goals = makeClient();

    await run(['list', '--workspace', 'clear', '--period', 'Q3-2026', '--status', 'active']);

    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalledWith(
      expect.anything(),
      'clear',
    );
    expect(goals.list).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      period: 'Q3-2026',
      status: 'active',
    });
  });

  it('falls back to the default workspace when --workspace is omitted', async () => {
    const goals = makeClient();

    await run(['list']);

    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
    );
    expect(goals.list).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      period: undefined,
      status: undefined,
    });
  });

  it('emits JSON when piped', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['list', '--workspace', 'clear']);

    const out = jsonFromLog(log);
    expect(out.total).toBe(1);
    expect((out.goals as Record<string, unknown>[])[0]).toMatchObject({
      id: 46,
      title: 'Ship OKR support',
      period: 'Q3-2026',
    });
  });

  it('--tree reads the cascade instead of the flat list', async () => {
    const goals = makeClient();

    await run(['list', '--workspace', 'clear', '--tree', '--status', 'active']);

    expect(goals.tree).toHaveBeenCalledWith({ workspaceId: 'ws1', status: 'active' });
    expect(goals.list).not.toHaveBeenCalled();
  });

  it('rejects an unknown status before making a call', async () => {
    const goals = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await run(['list', '--workspace', 'clear', '--status', 'nope']);

    expect(goals.list).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('goals update — never clobbers', () => {
  // The reason this command exists in this shape. Under the old server
  // behaviour `{id, title}` also nulled period and workspaceId, orphaning the
  // goal out of its workspace. The CLI must send exactly the flags it was
  // given — no re-sent fields, no synthesised nulls.
  it('a title-only update sends only id and title', async () => {
    const goals = makeClient();

    await run(['update', '--id', '46', '--title', 'Renamed']);

    expect(goals.update).toHaveBeenCalledTimes(1);
    const sent = goals.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.id).toBe(46);
    expect(sent.title).toBe('Renamed');
    for (const key of ['period', 'workspaceId', 'projectId', 'description', 'driUserId']) {
      expect(sent[key], `${key} must not be written`).toBeUndefined();
    }
  });

  it('does not read the goal first — nothing is re-sent from a fetch', async () => {
    const goals = makeClient();

    await run(['update', '--id', '46', '--title', 'Renamed']);

    expect(goals.get).not.toHaveBeenCalled();
  });

  it('"none" becomes an explicit null so a field can still be cleared', async () => {
    const goals = makeClient();

    await run(['update', '--id', '46', '--period', 'none', '--project', 'none']);

    const sent = goals.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.period).toBeNull();
    expect(sent.projectId).toBeNull();
    expect(sent.title).toBeUndefined();
  });

  it('refuses on-hold, pointing at set-status', async () => {
    const goals = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'log');

    await run(['update', '--id', '46', '--status', 'on-hold']);

    expect(goals.update).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(jsonFromLog(log))).toContain('set-status');
  });
});

describe('goals set-status and close', () => {
  it('set-status routes through the status-only path, never update', async () => {
    const goals = makeClient();

    await run(['set-status', '--id', '46', '--status', 'completed']);

    expect(goals.setStatus).toHaveBeenCalledWith({ id: 46, status: 'completed' });
    expect(goals.update).not.toHaveBeenCalled();
  });

  it('set-status accepts on-hold', async () => {
    const goals = makeClient();

    await run(['set-status', '--id', '46', '--status', 'on-hold']);

    expect(goals.setStatus).toHaveBeenCalledWith({ id: 46, status: 'on-hold' });
  });

  it('close defaults to completed and also avoids update', async () => {
    const goals = makeClient();

    await run(['close', '--id', '46']);

    expect(goals.setStatus).toHaveBeenCalledWith({ id: 46, status: 'completed' });
    expect(goals.update).not.toHaveBeenCalled();
  });

  it('close --status archived archives instead', async () => {
    const goals = makeClient();

    await run(['close', '--id', '46', '--status', 'archived']);

    expect(goals.setStatus).toHaveBeenCalledWith({ id: 46, status: 'archived' });
  });
});

describe('goals reparent', () => {
  it('routes through setParent, never update', async () => {
    const goals = makeClient();

    await run(['reparent', '--id', '47', '--parent', '15']);

    expect(goals.setParent).toHaveBeenCalledWith({ id: 47, parentGoalId: 15 });
    expect(goals.update).not.toHaveBeenCalled();
  });

  it('--parent none detaches', async () => {
    const goals = makeClient();

    await run(['reparent', '--id', '47', '--parent', 'none']);

    expect(goals.setParent).toHaveBeenCalledWith({ id: 47, parentGoalId: null });
  });

  it('rejects a non-numeric goal id with a readable message', async () => {
    const goals = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'log');

    await run(['reparent', '--id', 'clabc', '--parent', '15']);

    expect(goals.setParent).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(jsonFromLog(log))).toContain('whole number');
  });
});

describe('goals create', () => {
  it('resolves the workspace slug and forwards the fields', async () => {
    const goals = makeClient();

    await run([
      'create',
      '--workspace', 'clear',
      '--title', 'Grow activation',
      '--period', 'Q3-2026',
      '--parent', '15',
    ]);

    expect(goals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        title: 'Grow activation',
        period: 'Q3-2026',
        parentGoalId: 15,
      }),
    );
  });
});

describe('goals kr', () => {
  it('lists without widening to a workspace when none is named', async () => {
    const goals = makeClient();

    await run(['kr', 'list', '--goal', '46']);

    expect(resolveModule.resolveWorkspaceId).not.toHaveBeenCalled();
    expect(goals.keyResults.list).toHaveBeenCalledWith({
      workspaceId: undefined,
      goalId: 46,
      period: undefined,
      status: undefined,
      onlyMine: undefined,
    });
  });

  it('resolves a workspace slug for a workspace-wide list', async () => {
    const goals = makeClient();

    await run(['kr', 'list', '--workspace', 'clear', '--status', 'at-risk']);

    expect(goals.keyResults.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', status: 'at-risk' }),
    );
  });

  it('inherits the objective period when --period is omitted on create', async () => {
    const goals = makeClient();

    await run(['kr', 'create', '--goal', '46', '--title', 'NPS 30 → 45', '--target', '45']);

    expect(goals.get).toHaveBeenCalledWith(46);
    expect(goals.keyResults.create).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 46, targetValue: 45, period: 'Q3-2026' }),
    );
  });

  it('requires --period when the objective has none', async () => {
    const goals = makeClient({ goal: makeGoal({ period: null }) });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'log');

    await run(['kr', 'create', '--goal', '46', '--title', 'NPS', '--target', '45']);

    expect(goals.keyResults.create).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(jsonFromLog(log))).toContain('--period is required');
  });

  it('checkin sends the ergonomic shape', async () => {
    const goals = makeClient();

    await run(['kr', 'checkin', '--id', 'clkr1', '--value', '90', '--note', 'shipped']);

    expect(goals.keyResults.checkIn).toHaveBeenCalledWith({
      id: 'clkr1',
      value: 90,
      note: 'shipped',
    });
  });

  it('update writes only the flags passed', async () => {
    const goals = makeClient();

    await run(['kr', 'update', '--id', 'clkr1', '--target', '150']);

    const sent = goals.keyResults.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: 'clkr1', targetValue: 150 });
    expect(sent.title).toBeUndefined();
    expect(sent.currentValue).toBeUndefined();
  });

  it('link takes exactly one of --project or --feature', async () => {
    const goals = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await run(['kr', 'link', '--id', 'clkr1']);
    expect(goals.keyResults.linkProject).not.toHaveBeenCalled();
    expect(goals.keyResults.linkFeature).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);

    await run(['kr', 'link', '--id', 'clkr1', '--project', 'p1', '--feature', 'f1']);
    expect(goals.keyResults.linkProject).not.toHaveBeenCalled();
  });

  it('links a project and a feature through their own procedures', async () => {
    const goals = makeClient();

    await run(['kr', 'link', '--id', 'clkr1', '--project', 'p1']);
    await run(['kr', 'link', '--id', 'clkr1', '--feature', 'f1']);
    await run(['kr', 'unlink', '--id', 'clkr1', '--project', 'p1']);
    await run(['kr', 'unlink', '--id', 'clkr1', '--feature', 'f1']);

    expect(goals.keyResults.linkProject).toHaveBeenCalledWith({
      keyResultId: 'clkr1',
      projectId: 'p1',
    });
    expect(goals.keyResults.linkFeature).toHaveBeenCalledWith({
      keyResultId: 'clkr1',
      featureId: 'f1',
    });
    expect(goals.keyResults.unlinkProject).toHaveBeenCalledWith({
      keyResultId: 'clkr1',
      projectId: 'p1',
    });
    expect(goals.keyResults.unlinkFeature).toHaveBeenCalledWith({
      keyResultId: 'clkr1',
      featureId: 'f1',
    });
  });

  it('reports progress against the start → target span in JSON', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['kr', 'list', '--goal', '46']);

    const out = jsonFromLog(log);
    // Span is start → target (40 → 120), not 0 → target: 50 of 80 = 63%.
    expect((out.keyResults as Record<string, unknown>[])[0]).toMatchObject({
      id: 'clkr1',
      progress: 63,
    });
  });
});

describe('okrs command group', () => {
  it('okrs list reads objectives with key results nested', async () => {
    const goals = makeClient();

    await runOkrs(['list', '--workspace', 'clear', '--period', 'Q3-2026']);

    expect(goals.keyResults.byObjective).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      period: 'Q3-2026',
      includePairedPeriod: undefined,
      onlyMine: undefined,
    });
  });

  it('okrs list --mine and --paired-period forward through', async () => {
    const goals = makeClient();

    await runOkrs(['list', '--workspace', 'clear', '--mine', '--paired-period']);

    expect(goals.keyResults.byObjective).toHaveBeenCalledWith(
      expect.objectContaining({ onlyMine: true, includePairedPeriod: true }),
    );
  });

  it('exposes the same kr subtree as goals', async () => {
    const goals = makeClient();

    await runOkrs(['kr', 'list', '--goal', '46']);

    expect(goals.keyResults.list).toHaveBeenCalled();
  });

  it('okrs stats and periods work without a goals detour', async () => {
    const goals = makeClient();

    await runOkrs(['stats', '--workspace', 'clear', '--period', 'Q3-2026']);
    await runOkrs(['periods']);

    expect(goals.stats).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      period: 'Q3-2026',
    });
    expect(goals.periods).toHaveBeenCalled();
  });
});

describe('goals periods and stats', () => {
  it('stats resolves the workspace and prints JSON when piped', async () => {
    const goals = makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['stats', '--workspace', 'clear']);

    expect(goals.stats).toHaveBeenCalledWith({ workspaceId: 'ws1', period: undefined });
    expect(jsonFromLog(log)).toMatchObject({ totalObjectives: 3, totalKeyResults: 7 });
  });

  it('periods needs no workspace', async () => {
    const goals = makeClient();

    await run(['periods']);

    expect(resolveModule.resolveWorkspaceId).not.toHaveBeenCalled();
    expect(goals.periods).toHaveBeenCalled();
  });
});

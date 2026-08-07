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
  resolveWorkspace: vi.fn(),
  resolveProductId: vi.fn(),
}));

const WS1 = { id: 'ws1', slug: 'clear', name: 'CLEAR' };
const WS2 = { id: 'ws2', slug: 'personal', name: 'Personal' };

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
  const listWorkspaces = vi.fn().mockResolvedValue([WS1, WS2]);
  const client = { goals, workspaces: { list: listWorkspaces } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  vi.mocked(resolveModule.resolveWorkspace).mockResolvedValue(
    WS1 as unknown as Awaited<ReturnType<typeof resolveModule.resolveWorkspace>>,
  );
  return Object.assign(goals, { listWorkspaces });
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

    expect(resolveModule.resolveWorkspace).toHaveBeenCalledWith(
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

    expect(resolveModule.resolveWorkspace).toHaveBeenCalledWith(
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

describe('spec contract: --all-workspaces', () => {
  // "Am I neglecting a goal" is inherently cross-workspace, so the flag fans
  // out over every workspace rather than making each caller write the loop.
  it('goals list queries every workspace and concatenates', async () => {
    const goals = makeClient();

    await run(['list', '--all-workspaces']);

    expect(goals.listWorkspaces).toHaveBeenCalled();
    expect(resolveModule.resolveWorkspace).not.toHaveBeenCalled();
    expect(goals.list).toHaveBeenCalledTimes(2);
    expect(goals.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1' }),
    );
    expect(goals.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws2' }),
    );
  });

  it('labels each goal with the workspace it came from', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['list', '--all-workspaces']);

    const rows = jsonFromLog(log).goals as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.map((g) => (g.workspace as { slug: string }).slug)).toEqual([
      'clear',
      'personal',
    ]);
  });

  it('okrs list fans out too', async () => {
    const goals = makeClient();

    await runOkrs(['list', '--all-workspaces']);

    expect(goals.keyResults.byObjective).toHaveBeenCalledTimes(2);
  });

  it('rejects --all-workspaces combined with --workspace', async () => {
    const goals = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'log');

    await run(['list', '--all-workspaces', '--workspace', 'clear']);

    expect(goals.list).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(jsonFromLog(log))).toContain('mutually exclusive');
  });

  it('-w is accepted as shorthand for --workspace', async () => {
    const goals = makeClient();

    await run(['list', '-w', 'clear']);

    expect(resolveModule.resolveWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      'clear',
    );
    expect(goals.list).toHaveBeenCalled();
  });
});

describe('spec contract: okrs list period default and status filter', () => {
  it('defaults to the current quarter', async () => {
    const goals = makeClient();
    const now = new Date();
    const expected = `Q${Math.floor(now.getMonth() / 3) + 1}-${now.getFullYear()}`;

    await runOkrs(['list', '--workspace', 'clear']);

    expect(goals.keyResults.byObjective).toHaveBeenCalledWith(
      expect.objectContaining({ period: expected }),
    );
  });

  it('--period all opts out of the default', async () => {
    const goals = makeClient();

    await runOkrs(['list', '--workspace', 'clear', '--period', 'all']);

    expect(goals.keyResults.byObjective).toHaveBeenCalledWith(
      expect.objectContaining({ period: undefined }),
    );
  });

  // --status is a key-result filter, and an objective with no matching key
  // result is noise in a "what's off-track" view, so it drops out entirely.
  it('--status keeps only matching key results and drops emptied objectives', async () => {
    const goals = makeClient();
    goals.keyResults.byObjective.mockResolvedValue([
      {
        id: 1,
        title: 'Mixed',
        status: 'active',
        period: 'Q3-2026',
        health: null,
        description: null,
        workspaceId: 'ws1',
        driUserId: null,
        parentGoalId: null,
        progress: 0,
        statusCounts: { 'on-track': 1, 'at-risk': 0, 'off-track': 1, achieved: 0 },
        keyResults: [
          makeKeyResult({ id: 'kr-ok', status: 'on-track' }),
          makeKeyResult({ id: 'kr-bad', status: 'off-track' }),
        ],
      },
      {
        id: 2,
        title: 'All fine',
        status: 'active',
        period: 'Q3-2026',
        health: null,
        description: null,
        workspaceId: 'ws1',
        driUserId: null,
        parentGoalId: null,
        progress: 0,
        statusCounts: { 'on-track': 1, 'at-risk': 0, 'off-track': 0, achieved: 0 },
        keyResults: [makeKeyResult({ id: 'kr-fine', status: 'on-track' })],
      },
    ]);
    const log = vi.spyOn(console, 'log');

    await runOkrs(['list', '--workspace', 'clear', '--status', 'off-track']);

    const out = jsonFromLog(log);
    const objectives = out.objectives as Record<string, unknown>[];
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.id).toBe(1);
    expect((objectives[0]!.keyResults as { id: string }[]).map((k) => k.id)).toEqual([
      'kr-bad',
    ]);
    expect(out.totalKeyResults).toBe(1);
  });

  it('rejects an unknown key-result status', async () => {
    const goals = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await runOkrs(['list', '--workspace', 'clear', '--status', 'nope']);

    expect(goals.keyResults.byObjective).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('spec contract: JSON fields', () => {
  it('goals list carries progress, workspace and the project join', async () => {
    const goals = makeClient();
    goals.list.mockResolvedValue([
      makeGoal({
        resolvedProgress: 61,
        isProgressManual: false,
        workspace: WS1,
        lifeDomain: { id: 3, title: 'Career/Business' },
        projects: [{ id: 'prj_launch', name: 'Q3 Launch', slug: 'q3-launch' }],
        _count: { keyResults: 3 },
      }),
    ]);
    const log = vi.spyOn(console, 'log');

    await run(['list', '--workspace', 'clear']);

    expect((jsonFromLog(log).goals as Record<string, unknown>[])[0]).toMatchObject({
      id: 46,
      progress: 61,
      isProgressManual: false,
      workspace: { id: 'ws1', slug: 'clear', name: 'CLEAR' },
      lifeDomain: { id: 3, title: 'Career/Business' },
      projects: [{ id: 'prj_launch', name: 'Q3 Launch', slug: 'q3-launch' }],
      keyResultCount: 3,
    });
  });

  it('reports progress as null rather than 0 when the server omits it', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['list', '--workspace', 'clear']);

    const row = (jsonFromLog(log).goals as Record<string, unknown>[])[0]!;
    expect(row.progress).toBeNull();
    expect(row.isProgressManual).toBe(false);
  });

  it('key results carry unitLabel, periodEnd and a derived lastCheckInAt', async () => {
    const goals = makeClient();
    goals.keyResults.list.mockResolvedValue([
      makeKeyResult({
        unitLabel: 'deals',
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        // Deliberately out of order: lastCheckInAt is the newest, not the first.
        checkIns: [
          { id: 'c1', createdAt: new Date('2026-07-02T09:14:00Z') },
          { id: 'c2', createdAt: new Date('2026-07-20T09:14:00Z') },
          { id: 'c3', createdAt: new Date('2026-07-11T09:14:00Z') },
        ],
      }),
    ]);
    const log = vi.spyOn(console, 'log');

    await run(['kr', 'list', '--goal', '46']);

    expect((jsonFromLog(log).keyResults as Record<string, unknown>[])[0]).toMatchObject({
      unitLabel: 'deals',
      periodEnd: '2026-09-30T00:00:00.000Z',
      lastCheckInAt: '2026-07-20T09:14:00.000Z',
    });
  });

  it('reports lastCheckInAt as null for a key result never checked in', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['kr', 'list', '--goal', '46']);

    expect((jsonFromLog(log).keyResults as Record<string, unknown>[])[0]).toMatchObject({
      lastCheckInAt: null,
      unitLabel: null,
      periodEnd: null,
    });
  });
});

describe('cross-workspace fan-out keeps partial results', () => {
  // A sweep exists to answer "what am I neglecting". One workspace the caller
  // can no longer read must not take the others with it — byObjective throws
  // FORBIDDEN for a non-member, and membership lapses.
  it('reports the goals it could read and warns about the one it could not', async () => {
    const goals = makeClient();
    goals.list
      .mockResolvedValueOnce([makeGoal({ id: 1 })])
      .mockRejectedValueOnce(new Error('You are not a member of this workspace'));
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');

    await run(['list', '--all-workspaces']);

    const rows = jsonFromLog(log).goals as Record<string, unknown>[];
    expect(rows.map((g) => g.id)).toEqual([1]);
    const warned = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('skipped workspace personal');
    expect(warned).toContain('not a member');
  });

  it('still fails loudly when every workspace fails', async () => {
    const goals = makeClient();
    goals.list.mockRejectedValue(new Error('token expired'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'log');

    await run(['list', '--all-workspaces']);

    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(jsonFromLog(log))).toContain('token expired');
  });

  it('a single-workspace read still surfaces its error rather than an empty list', async () => {
    const goals = makeClient();
    goals.list.mockRejectedValue(new Error('workspace is gone'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'log');

    await run(['list', '--workspace', 'clear']);

    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(jsonFromLog(log))).toContain('workspace is gone');
  });

  it('okrs list isolates per workspace too', async () => {
    const goals = makeClient();
    goals.keyResults.byObjective
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('forbidden'));
    const error = vi.spyOn(console, 'error');

    await runOkrs(['list', '--all-workspaces']);

    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'skipped workspace personal',
    );
  });
});

describe('goals kr create reuses the objective it already read', () => {
  it("passes the objective's workspace so the SDK need not re-read it", async () => {
    const goals = makeClient();

    await run(['kr', 'create', '--goal', '46', '--title', 'NPS', '--target', '45']);

    expect(goals.get).toHaveBeenCalledTimes(1);
    expect(goals.keyResults.create).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 46, workspaceId: 'ws1' }),
    );
  });

  it('leaves the workspace to the SDK when --period made the read unnecessary', async () => {
    const goals = makeClient();

    await run([
      'kr', 'create', '--goal', '46', '--title', 'NPS',
      '--target', '45', '--period', 'Q3-2026',
    ]);

    expect(goals.get).not.toHaveBeenCalled();
    expect(goals.keyResults.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: undefined }),
    );
  });
});

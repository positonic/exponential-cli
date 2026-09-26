import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { Command } from 'commander';
import { createDealsCommand } from './deals.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

vi.mock('../config/index.js', () => ({
  getConfig: () => ({ defaultWorkspaceSlug: 'syntrofi' }),
}));

const SALES_ID = 'cmoldpipe0000000000000001';
const CLOSE3_ID = 'cmtv8ufge0001gu04f9dz1irm';

function makeStage(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    projectId: SALES_ID,
    name: 'Lead',
    color: 'blue',
    order: 0,
    type: 'open',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: SALES_ID,
    name: 'Sales',
    workspaceId: 'ws1',
    status: 'ACTIVE',
    pipelineStages: [makeStage(), makeStage({ id: 's2', name: 'Won', type: 'won', order: 1 })],
    ...overrides,
  };
}

const SALES = makePipeline();
const CLOSE3 = makePipeline({
  id: CLOSE3_ID,
  name: 'Close 3 paying clients by Dec 2026',
  status: 'IN_PROGRESS',
  pipelineStages: [makeStage({ id: 'c1', projectId: CLOSE3_ID, name: 'Intro call' })],
});

function makeDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    projectId: SALES_ID,
    stageId: 's1',
    title: 'Acme',
    description: null,
    value: null,
    currency: 'USD',
    probability: null,
    expectedCloseDate: null,
    closedAt: null,
    stageOrder: 0,
    contactId: null,
    organizationId: null,
    workspaceId: 'ws1',
    createdById: 'u1',
    assignedToId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeClient(pipelines: Record<string, unknown>[] = [SALES, CLOSE3]) {
  const calls = {
    list: vi.fn().mockResolvedValue(pipelines),
    get: vi.fn().mockImplementation((_ws: string, id?: string) =>
      Promise.resolve(pipelines.find((p) => p.id === (id ?? pipelines[0]?.id)) ?? null),
    ),
    getStages: vi.fn().mockImplementation((_ws: string, id?: string) =>
      Promise.resolve(
        (pipelines.find((p) => p.id === (id ?? pipelines[0]?.id))?.pipelineStages as unknown[]) ?? [],
      ),
    ),
    listDeals: vi.fn().mockResolvedValue([makeDeal()]),
    createDeal: vi.fn().mockResolvedValue(makeDeal()),
    workspaceList: vi.fn().mockResolvedValue([{ id: 'ws1', slug: 'syntrofi', name: 'Syntrofi' }]),
  };
  const client = {
    pipelines: {
      list: calls.list,
      get: calls.get,
      getStages: calls.getStages,
      listDeals: calls.listDeals,
      createDeal: calls.createDeal,
    },
    workspaces: { list: calls.workspaceList },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return calls;
}

// Run args as if typed after `exponential deals`, under the program's global
// --json/--pretty flags so the TTY-vs-JSON branches are exercised for real.
async function run(args: string[]) {
  const program = new Command()
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Force pretty output')
    .addCommand(createDealsCommand());
  program.exitOverride();
  await program.parseAsync(['deals', ...args], { from: 'user' });
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
let stderr: MockInstance<typeof process.stderr.write>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = originalExitCode;
});

describe('deals pipelines', () => {
  it('lists every pipeline with stage counts and marks the default', async () => {
    const calls = makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['pipelines', '--workspace', 'syntrofi', '--json']);

    expect(calls.list).toHaveBeenCalledWith('ws1');
    expect(jsonFromLog(log)).toEqual({
      pipelines: [
        { id: SALES_ID, name: 'Sales', status: 'ACTIVE', stageCount: 2, isDefault: true },
        {
          id: CLOSE3_ID,
          name: 'Close 3 paying clients by Dec 2026',
          status: 'IN_PROGRESS',
          stageCount: 1,
          isDefault: false,
        },
      ],
      total: 2,
    });
  });

  it('falls back to the configured default workspace', async () => {
    const calls = makeClient();

    await run(['pipelines', '--json']);

    expect(calls.list).toHaveBeenCalledWith('ws1');
  });
});

describe('--pipeline resolution', () => {
  it('targets a pipeline by name on deals pipeline', async () => {
    const calls = makeClient();

    await run(['pipeline', '--workspace', 'ws1', '--pipeline', 'close 3 paying clients by dec 2026']);

    expect(calls.get).toHaveBeenCalledWith('ws1', CLOSE3_ID);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('targets a pipeline by slug-prefixed id on deals stages', async () => {
    const calls = makeClient();

    await run(['stages', '--workspace', 'ws1', '--pipeline', `close_3-${CLOSE3_ID}`]);

    expect(calls.getStages).toHaveBeenCalledWith('ws1', CLOSE3_ID);
  });

  it('targets a pipeline by bare id on deals list', async () => {
    const calls = makeClient();

    await run(['list', '--workspace', 'ws1', '--pipeline', CLOSE3_ID]);

    expect(calls.listDeals).toHaveBeenCalledWith('ws1', CLOSE3_ID);
  });

  it('fails listing the available pipelines when nothing matches', async () => {
    makeClient();
    const error = vi.spyOn(console, 'error');

    await run(['list', '--workspace', 'ws1', '--pipeline', 'Hiring', '--pretty']);

    expect(exit).toHaveBeenCalledWith(1);
    const message = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('Pipeline "Hiring" not found');
    expect(message).toContain('"Sales"');
    expect(message).toContain('"Close 3 paying clients by Dec 2026"');
  });
});

describe('non-interactive fallback', () => {
  // Existing scripts pass only --workspace; they must keep getting the
  // default board, and be told which one that was.
  it('uses the default pipeline and prints a stderr notice when piped', async () => {
    const calls = makeClient();

    await run(['list', '--workspace', 'ws1']);

    expect(calls.listDeals).toHaveBeenCalledWith('ws1', SALES_ID);
    expect(stderr).toHaveBeenCalledTimes(1);
    const notice = String(stderr.mock.calls[0]![0]);
    expect(notice).toMatch(/^Using default pipeline "Sales" \(cmoldpipe0000000000000001\)/);
    expect(notice).toContain('--pipeline');
  });

  it('does not prompt or warn under --json even on a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const calls = makeClient();

    await run(['stages', '--workspace', 'ws1', '--json']);

    expect(calls.getStages).toHaveBeenCalledWith('ws1', SALES_ID);
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the workspace has exactly one pipeline', async () => {
    const calls = makeClient([SALES]);

    await run(['list', '--workspace', 'ws1']);

    expect(calls.listDeals).toHaveBeenCalledWith('ws1', SALES_ID);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('deals create', () => {
  it("resolves --stage against the chosen pipeline's stages, not the default board's", async () => {
    const calls = makeClient();

    await run([
      'create', '--workspace', 'ws1', '--pipeline', 'Close 3 paying clients by Dec 2026',
      '--stage', 'intro call', '--title', 'Acme',
    ]);

    expect(calls.getStages).toHaveBeenCalledWith('ws1', CLOSE3_ID);
    expect(calls.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', pipelineId: CLOSE3_ID, stageId: 'c1', title: 'Acme' }),
    );
  });

  it("rejects a stage that belongs to another pipeline", async () => {
    const calls = makeClient();
    const error = vi.spyOn(console, 'error');

    await run([
      'create', '--workspace', 'ws1', '--pipeline', 'Close 3 paying clients by Dec 2026',
      '--stage', 's1', '--title', 'Acme', '--pretty',
    ]);

    expect(calls.createDeal).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'Stage "s1" not found on pipeline "Close 3 paying clients by Dec 2026"',
    );
  });

  it('keeps accepting a stage id on the default board without --pipeline', async () => {
    const calls = makeClient();

    await run(['create', '--workspace', 'ws1', '--stage', 's2', '--title', 'Acme']);

    expect(calls.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: SALES_ID, stageId: 's2' }),
    );
    expect(stderr).toHaveBeenCalledTimes(1);
  });
});

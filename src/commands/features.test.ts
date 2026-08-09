import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFeaturesCommand } from './features.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

function makeFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feat1',
    productId: 'prod1',
    name: 'Bulk export',
    description: null,
    vision: null,
    status: 'DEFINED',
    effort: null,
    priority: null,
    goalId: null,
    areaId: null,
    createdById: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeTicket(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    productId: 'prod1',
    number: 12,
    shortId: `EXP-${id}`,
    title: `Ticket ${id}`,
    featureId: 'feat1',
    ...overrides,
  };
}

function makeClient(options: {
  feature?: Record<string, unknown>;
  tickets?: Record<string, unknown>[];
} = {}) {
  const getFeature = vi.fn().mockResolvedValue(options.feature ?? makeFeature());
  const deleteFeature = vi.fn().mockResolvedValue({ success: true });
  const updateFeature = vi.fn().mockResolvedValue(options.feature ?? makeFeature());
  const listTickets = vi.fn().mockResolvedValue(options.tickets ?? []);
  const deleteTicket = vi.fn().mockResolvedValue({ success: true });
  const client = {
    features: { get: getFeature, delete: deleteFeature, update: updateFeature },
    tickets: { list: listTickets, delete: deleteTicket },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { client, getFeature, deleteFeature, updateFeature, listTickets, deleteTicket };
}

// Run args as if typed after `exponential features`.
async function run(args: string[]) {
  const cmd = createFeaturesCommand();
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

describe('features delete', () => {
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

  it('deletes a feature with no tickets without any flag', async () => {
    const { deleteFeature, deleteTicket, listTickets } = makeClient({ tickets: [] });
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'feat1']);

    expect(listTickets).toHaveBeenCalledWith({ productId: 'prod1', featureId: 'feat1' });
    expect(deleteTicket).not.toHaveBeenCalled();
    expect(deleteFeature).toHaveBeenCalledWith('feat1');
    expect(jsonFromLog(log)).toEqual({
      deleted: true,
      id: 'feat1',
      ticketsDeleted: [],
      ticketsOrphaned: [],
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('skips the ticket lookup when the feature reports a zero ticket count', async () => {
    const { deleteFeature, listTickets } = makeClient({
      feature: makeFeature({ _count: { tickets: 0 } }),
    });

    await run(['delete', 'feat1']);

    expect(listTickets).not.toHaveBeenCalled();
    expect(deleteFeature).toHaveBeenCalledWith('feat1');
  });

  it('refuses — and deletes nothing — when the feature still has tickets', async () => {
    const { deleteFeature, deleteTicket } = makeClient({
      tickets: [makeTicket('t1'), makeTicket('t2')],
    });
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'feat1']);

    expect(deleteFeature).not.toHaveBeenCalled();
    expect(deleteTicket).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    const out = jsonFromLog(log);
    expect(out).toMatchObject({ deleted: false, id: 'feat1', reason: 'has 2 tickets' });
    expect(out.tickets).toEqual([
      { id: 't1', shortId: 'EXP-t1', number: 12, title: 'Ticket t1' },
      { id: 't2', shortId: 'EXP-t2', number: 12, title: 'Ticket t2' },
    ]);
  });

  it('explains the refusal on a TTY, naming the flags that unblock it', async () => {
    makeClient({ tickets: [makeTicket('t1')] });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const error = vi.spyOn(console, 'error');

    await run(['delete', 'feat1']);

    const printed = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('has 1 ticket.');
    expect(printed).toContain('--with-tickets');
    expect(printed).toContain('--orphan-tickets');
  });

  it('--with-tickets deletes every ticket first, then the feature', async () => {
    const { deleteFeature, deleteTicket } = makeClient({
      tickets: [makeTicket('t1'), makeTicket('t2')],
    });
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'feat1', '--with-tickets']);

    expect(deleteTicket).toHaveBeenCalledTimes(2);
    expect(deleteTicket).toHaveBeenNthCalledWith(1, 't1');
    expect(deleteTicket).toHaveBeenNthCalledWith(2, 't2');
    expect(deleteFeature).toHaveBeenCalledWith('feat1');

    const out = jsonFromLog(log);
    expect(out).toMatchObject({ deleted: true, id: 'feat1', ticketsOrphaned: [] });
    expect(out.ticketsDeleted).toHaveLength(2);
  });

  it('--with-tickets aborts without deleting the feature if a ticket delete fails', async () => {
    const { deleteFeature, deleteTicket } = makeClient({
      tickets: [makeTicket('t1'), makeTicket('t2')],
    });
    deleteTicket
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('ticket is locked'));
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'feat1', '--with-tickets']);

    expect(deleteFeature).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    const out = jsonFromLog(log);
    expect(out).toMatchObject({
      deleted: false,
      id: 'feat1',
      reason: 'failed to delete 1 of 2 tickets',
    });
    expect(out.ticketsDeleted).toHaveLength(1);
    expect(out.ticketsFailed).toHaveLength(1);
    expect((out.ticketsFailed as { error: string }[])[0]!.error).toContain('ticket is locked');
  });

  it('--orphan-tickets deletes the feature and leaves the tickets alone', async () => {
    const { deleteFeature, deleteTicket } = makeClient({
      tickets: [makeTicket('t1'), makeTicket('t2')],
    });
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'feat1', '--orphan-tickets']);

    expect(deleteTicket).not.toHaveBeenCalled();
    expect(deleteFeature).toHaveBeenCalledWith('feat1');
    expect(process.exitCode).toBeUndefined();

    const out = jsonFromLog(log);
    expect(out).toMatchObject({ deleted: true, id: 'feat1', ticketsDeleted: [] });
    expect(out.ticketsOrphaned).toHaveLength(2);
  });

  it('reports the orphan count on a TTY', async () => {
    makeClient({ tickets: [makeTicket('t1'), makeTicket('t2')] });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'feat1', '--orphan-tickets']);

    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('✓ Feature deleted');
    expect(printed).toContain('2 ticket(s) left unlinked');
  });

  it('rejects --with-tickets combined with --orphan-tickets', async () => {
    const { deleteFeature, deleteTicket } = makeClient({ tickets: [makeTicket('t1')] });
    const log = vi.spyOn(console, 'log');
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    await run(['delete', 'feat1', '--with-tickets', '--orphan-tickets']);

    expect(deleteFeature).not.toHaveBeenCalled();
    expect(deleteTicket).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(jsonFromLog(log))).toContain('mutually exclusive');
  });
});

describe('features update --goal', () => {
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

  it('links the feature to an objective by its integer id', async () => {
    const { updateFeature } = makeClient();

    await run(['update', '--id', 'feat1', '--goal', '46']);

    expect(updateFeature).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'feat1', goalId: 46 }),
    );
  });

  it('"none" clears the objective', async () => {
    const { updateFeature } = makeClient();

    await run(['update', '--id', 'feat1', '--goal', 'none']);

    expect(updateFeature).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: null }),
    );
  });

  it('leaves the objective alone when --goal is absent', async () => {
    const { updateFeature } = makeClient();

    await run(['update', '--id', 'feat1', '--name', 'Renamed']);

    const sent = updateFeature.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.goalId).toBeUndefined();
  });

  it('rejects a cuid where an objective id belongs', async () => {
    const { updateFeature } = makeClient();
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    await run(['update', '--id', 'feat1', '--goal', 'cmjoko555']);

    expect(updateFeature).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('features get — key result links (ADR-0050)', () => {
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

  const KR_LINK = {
    assignedAt: new Date('2026-08-01'),
    keyResult: {
      id: 'kr1',
      title: 'Ship 2 situational analysis modules',
      period: 'Q3-2026',
      goalId: 75,
      status: 'on-track',
      currentValue: 1,
      targetValue: 2,
      unit: 'count',
      unitLabel: null,
    },
  };

  it('carries the key results into --json, flattened off the join row', async () => {
    makeClient({ feature: makeFeature({ keyResultLinks: [KR_LINK] }) });
    const log = vi.spyOn(console, 'log');

    await run(['get', 'feat1']);

    expect(jsonFromLog(log).keyResults).toEqual([
      {
        keyResultId: 'kr1',
        title: 'Ship 2 situational analysis modules',
        period: 'Q3-2026',
        goalId: 75,
        status: 'on-track',
        currentValue: 1,
        targetValue: 2,
        unit: 'count',
      },
    ]);
  });

  it('reports null rather than [] when the server predates the readback', async () => {
    makeClient({ feature: makeFeature() });
    const log = vi.spyOn(console, 'log');

    await run(['get', 'feat1']);

    // Distinguishes "this server cannot tell you" from "no key results linked".
    expect(jsonFromLog(log).keyResults).toBeNull();
  });

  it('tolerates the lean list shape, where progress values are unselected', async () => {
    const lean = { keyResult: { id: 'kr1', title: 'Ship 2', period: 'Q3-2026', goalId: 75 } };
    makeClient({ feature: makeFeature({ keyResultLinks: [lean] }) });
    const log = vi.spyOn(console, 'log');

    await run(['get', 'feat1']);

    expect(jsonFromLog(log).keyResults).toEqual([
      {
        keyResultId: 'kr1',
        title: 'Ship 2',
        period: 'Q3-2026',
        goalId: 75,
        status: null,
        currentValue: null,
        targetValue: null,
        unit: null,
      },
    ]);
  });
});

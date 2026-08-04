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
  const listTickets = vi.fn().mockResolvedValue(options.tickets ?? []);
  const deleteTicket = vi.fn().mockResolvedValue({ success: true });
  const client = {
    features: { get: getFeature, delete: deleteFeature },
    tickets: { list: listTickets, delete: deleteTicket },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { client, getFeature, deleteFeature, listTickets, deleteTicket };
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

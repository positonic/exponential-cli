import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTicketsCommand } from './tickets.js';
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

function makeTicket(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    productId: 'p1',
    number: 1,
    shortId: `EXP-${id}`,
    title: `Ticket ${id}`,
    type: 'BUG',
    status: 'BACKLOG',
    branchName: null,
    prUrl: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeClient() {
  const listTickets = vi.fn().mockResolvedValue([]);
  const listProducts = vi.fn().mockResolvedValue([
    { id: 'p1', slug: 'alpha', name: 'Alpha' },
    { id: 'p2', slug: 'beta', name: 'Beta' },
  ]);
  const client = {
    tickets: { list: listTickets },
    products: { list: listProducts },
    labels: { listForEntity: vi.fn().mockResolvedValue([]) },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  vi.mocked(resolveModule.resolveProductId).mockResolvedValue('p1');
  return { listTickets, listProducts };
}

async function run(args: string[]) {
  const cmd = createTicketsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
});

// `product.ticket.list` is product-scoped server-side; there is no
// workspace-wide query. Sending productId: undefined got a BAD_REQUEST, so the
// advertised "--product optional when --pr/--branch is given" never worked.
describe('tickets list sweeps products for a --branch/--pr lookup', () => {
  it('queries every product in the workspace and merges the hits', async () => {
    const { listTickets, listProducts } = makeClient();
    listTickets
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeTicket('t9', { branchName: 'feat/x' })]);

    await run(['list', '--branch', 'feat/x', '--workspace', 'clear']);

    expect(listProducts).toHaveBeenCalledWith('ws1');
    expect(listTickets).toHaveBeenCalledTimes(2);
    expect(listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', branchName: 'feat/x' }),
    );
    expect(listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p2', branchName: 'feat/x' }),
    );
  });

  it('never sends an undefined productId', async () => {
    const { listTickets } = makeClient();

    await run(['list', '--pr', 'https://gh/x/pull/1', '--workspace', 'clear']);

    for (const [arg] of listTickets.mock.calls) {
      expect((arg as { productId?: string }).productId).toBeDefined();
    }
  });

  it('keeps going when one product is unreadable, and says so', async () => {
    const { listTickets } = makeClient();
    listTickets
      .mockResolvedValueOnce([makeTicket('t1', { branchName: 'feat/x' })])
      .mockRejectedValueOnce(new Error('no access to this product'));
    const error = vi.spyOn(console, 'error');

    await run(['list', '--branch', 'feat/x', '--workspace', 'clear']);

    const warned = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('skipped product beta');
    expect(warned).toContain('no access');
  });

  it('uses the single product directly when --product is given', async () => {
    const { listTickets, listProducts } = makeClient();

    await run(['list', '--product', 'alpha', '--workspace', 'clear']);

    expect(listProducts).not.toHaveBeenCalled();
    expect(listTickets).toHaveBeenCalledTimes(1);
    expect(listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1' }),
    );
  });

  it('still refuses a bare list with no product and no pr/branch', async () => {
    const { listTickets } = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await run(['list', '--workspace', 'clear']);

    expect(listTickets).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProductsCommand } from './products.js';
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

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cprod1',
    workspaceId: 'ws1',
    name: 'Alpha',
    slug: 'alpha',
    description: null,
    icon: null,
    color: null,
    funTicketIds: false,
    ticketCounter: 0,
    createdById: 'u1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    _count: { features: 0, tickets: 0, researches: 0, retrospectives: 0 },
    ...overrides,
  };
}

function makeClient(product = makeProduct()) {
  const calls = {
    resolve: vi.fn().mockResolvedValue(product),
    update: vi.fn().mockResolvedValue(makeProduct({ name: 'Renamed' })),
    deleteProduct: vi.fn().mockResolvedValue({ success: true }),
  };
  const client = {
    products: {
      resolve: calls.resolve,
      update: calls.update,
      delete: calls.deleteProduct,
    },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  return calls;
}

// Run args as if typed after `exponential products`.
async function run(args: string[]) {
  const cmd = createProductsCommand();
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

describe('products update', () => {
  it('resolves a slug and sends only the fields passed', async () => {
    const calls = makeClient();

    await run(['update', 'alpha', '--workspace', 'clear', '--name', 'Renamed']);

    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalledWith(expect.anything(), 'clear');
    expect(calls.resolve).toHaveBeenCalledWith('ws1', 'alpha');
    expect(calls.update).toHaveBeenCalledWith({
      id: 'cprod1',
      name: 'Renamed',
      description: undefined,
      icon: undefined,
      color: undefined,
      funTicketIds: undefined,
    });
  });

  it('--fun-ticket-ids and --no-fun-ticket-ids toggle the flag', async () => {
    const calls = makeClient();

    await run(['update', 'alpha', '--fun-ticket-ids']);
    await run(['update', 'alpha', '--no-fun-ticket-ids']);

    expect(calls.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ funTicketIds: true }));
    expect(calls.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ funTicketIds: false }));
  });

  it('emits the updated product as JSON when piped', async () => {
    makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['update', 'alpha', '--name', 'Renamed']);

    expect(jsonFromLog(log)).toMatchObject({ id: 'cprod1', name: 'Renamed' });
  });
});

describe('products delete guards the cascade', () => {
  it('deletes an empty product', async () => {
    const calls = makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'alpha']);

    expect(calls.deleteProduct).toHaveBeenCalledWith('cprod1');
    expect(jsonFromLog(log)).toMatchObject({ deleted: true, id: 'cprod1', slug: 'alpha' });
    expect(process.exitCode).toBeUndefined();
  });

  it('refuses while features or tickets would go with it', async () => {
    const calls = makeClient(
      makeProduct({ _count: { features: 2, tickets: 7, researches: 0, retrospectives: 0 } }),
    );
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'alpha']);

    expect(calls.deleteProduct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    const out = jsonFromLog(log);
    expect(out).toMatchObject({ deleted: false, id: 'cprod1' });
    expect(String(out.reason)).toContain('2 feature(s)');
    expect(String(out.reason)).toContain('7 ticket(s)');
  });

  it('--force goes ahead anyway', async () => {
    const calls = makeClient(
      makeProduct({ _count: { features: 2, tickets: 7, researches: 0, retrospectives: 0 } }),
    );
    const log = vi.spyOn(console, 'log');

    await run(['delete', 'alpha', '--force']);

    expect(calls.deleteProduct).toHaveBeenCalledWith('cprod1');
    expect(jsonFromLog(log)).toMatchObject({ deleted: true, id: 'cprod1' });
  });
});

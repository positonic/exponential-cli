import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEpicsCommand } from './epics.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

function makeClient() {
  const remove = vi.fn().mockResolvedValue({ success: true });
  const update = vi.fn().mockResolvedValue({
    id: 'cepic1',
    workspaceId: 'ws1',
    name: 'Payments',
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    startDate: null,
    targetDate: null,
    ownerId: 'u2',
    owner: { id: 'u2', name: 'Ada', email: 'ada@example.com', image: null },
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  });
  const client = { epics: { delete: remove, update } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { remove, update };
}

// Run args as if typed after `exponential epics`.
async function run(args: string[]) {
  const cmd = createEpicsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
});

describe('epics delete', () => {
  it('deletes the epic by --id and reports it as JSON when piped', async () => {
    const { remove } = makeClient();
    const log = vi.spyOn(console, 'log');

    await run(['delete', '--id', 'cepic1']);

    expect(remove).toHaveBeenCalledWith('cepic1');
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ deleted: true, id: 'cepic1' });
  });

  it('requires --id', async () => {
    const { remove } = makeClient();
    const cmd = createEpicsCommand();
    cmd.exitOverride();
    for (const sub of cmd.commands) {
      sub.exitOverride();
      sub.configureOutput({ writeErr: () => undefined });
    }

    await expect(cmd.parseAsync(['delete'], { from: 'user' })).rejects.toThrow(/--id/);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('epics update --owner', () => {
  it('hands the epic over by forwarding ownerId', async () => {
    const { update } = makeClient();

    const log = vi.spyOn(console, 'log');

    await run(['update', '--id', 'cepic1', '--owner', 'u2']);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'cepic1', ownerId: 'u2' }));
    // Piped: the updated epic comes back as JSON with its new owner.
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      id: 'cepic1',
      ownerId: 'u2',
      owner: { id: 'u2', name: 'Ada' },
    });
  });

  it('sends the "null" sentinel as null, like tickets update --assignee', async () => {
    const { update } = makeClient();

    await run(['update', '--id', 'cepic1', '--owner', 'null']);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null }));
  });

  it('leaves ownerId undefined when --owner is not given', async () => {
    const { update } = makeClient();

    await run(['update', '--id', 'cepic1', '--name', 'Renamed']);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toMatchObject({ id: 'cepic1', name: 'Renamed' });
    expect(update.mock.calls[0]![0].ownerId).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEpicsCommand } from './epics.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

function makeClient() {
  const remove = vi.fn().mockResolvedValue({ success: true });
  const client = { epics: { delete: remove } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { remove };
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

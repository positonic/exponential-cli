import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { buildProgram, isBareVersionRequest, PKG_VERSION } from './program.js';
import * as clientModule from './client/index.js';

vi.mock('./client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

function makeScope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scope1',
    featureId: 'feat1',
    version: 'V1',
    description: 'First cut',
    status: 'PLANNED',
    shippedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeClient() {
  const create = vi.fn().mockResolvedValue(makeScope());
  const update = vi.fn().mockResolvedValue(makeScope({ version: 'V2' }));
  const client = { scopes: { create, update } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { create, update };
}

// Commander's exitOverride is not inherited through addCommand(), so apply it
// to the whole tree — otherwise a parse error calls process.exit mid-test.
function overrideExits(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) overrideExits(sub);
}

// Run args as if typed after `exponential`, capturing what commander writes.
async function run(args: string[]): Promise<{ out: string[] }> {
  const out: string[] = [];
  const program = buildProgram();
  overrideExits(program);
  program.configureOutput({
    writeOut: (s) => out.push(s),
    writeErr: (s) => out.push(s),
  });
  await program.parseAsync(args, { from: 'user' });
  return { out };
}

describe('root --version does not shadow subcommand flags', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  it('features scopes add --version V1 creates a scope (regression: printed the CLI version)', async () => {
    const { create } = makeClient();

    await run(['features', 'scopes', 'add', '--feature', 'feat1', '--version', 'V1', '-d', 'First cut']);

    expect(create).toHaveBeenCalledWith({
      featureId: 'feat1',
      version: 'V1',
      description: 'First cut',
      status: undefined,
    });
  });

  it('features scopes update --version V2 relabels the scope', async () => {
    const { update } = makeClient();

    await run(['features', 'scopes', 'update', '--id', 'scope1', '--version', 'V2']);

    expect(update).toHaveBeenCalledWith({
      id: 'scope1',
      version: 'V2',
      description: undefined,
      status: undefined,
    });
  });

  it('-V and --cli-version still print the package version', async () => {
    for (const flag of ['-V', '--cli-version']) {
      await expect(run([flag])).rejects.toMatchObject({ code: 'commander.version' });
    }
  });

  it('bare `exponential --version` is recognised for the compatibility shim', () => {
    expect(isBareVersionRequest(['--version'])).toBe(true);
    expect(isBareVersionRequest(['-V'])).toBe(false);
    expect(isBareVersionRequest(['features', 'scopes', 'add', '--version', 'V1'])).toBe(false);
    expect(isBareVersionRequest([])).toBe(false);
  });

  it('PKG_VERSION is read from package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
      version: string;
    };
    expect(PKG_VERSION).toBe(pkg.version);
  });
});

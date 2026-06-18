import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { createStoriesCommand } from './stories.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

function makeClient() {
  const create = vi.fn().mockResolvedValue({
    id: 'us1',
    featureId: 'f1',
    scopeId: null,
    asA: null,
    iWant: null,
    soThat: null,
    acceptanceCriteria: null,
    displayOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  const list = vi.fn().mockResolvedValue([]);
  const client = { userStories: { create, list } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { client, create, list };
}

// Run the `stories` subcommand with args, as if typed after `features stories`.
async function run(args: string[]) {
  const cmd = createStoriesCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;

function pipeStdin(text: string) {
  const fake = Readable.from([Buffer.from(text)]);
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
}

describe('features stories add — flag mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    // A TTY stdin so batch mode is NOT triggered.
    Object.defineProperty(process, 'stdin', {
      value: { isTTY: true },
      configurable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(process, 'stdin', originalStdin);
  });

  it('maps --as-a/--i-want/--so-that/--acceptance/--scope to a single create call', async () => {
    const { create } = makeClient();
    await run([
      'add',
      '--feature', 'f1',
      '--as-a', 'CLI user',
      '--i-want', 'to add a story',
      '--so-that', 'it is native',
      '--acceptance', 'a row appears',
      '--scope', 'scope1',
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      featureId: 'f1',
      asA: 'CLI user',
      iWant: 'to add a story',
      soThat: 'it is native',
      acceptanceCriteria: 'a row appears',
      scopeId: 'scope1',
    });
  });

  it('emits JSON when stdout is not a TTY', async () => {
    const { create } = makeClient();
    const log = vi.spyOn(console, 'log');
    await run(['add', '--feature', 'f1', '--i-want', 'x']);

    expect(create).toHaveBeenCalledTimes(1);
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    // The JSON branch prints a parseable object with the new story id.
    const jsonLine = log.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.trim().startsWith('{'));
    expect(jsonLine).toBeDefined();
    expect(JSON.parse(jsonLine!)).toMatchObject({ id: 'us1' });
    expect(printed).not.toContain('✓');
  });

  it('uses pretty output when stdout is a TTY', async () => {
    makeClient();
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const log = vi.spyOn(console, 'log');
    await run(['add', '--feature', 'f1', '--i-want', 'x']);

    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('✓ User story added');
  });
});

describe('features stories add — batch stdin mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(process, 'stdin', originalStdin);
  });

  it('parses a JSON array into N create calls in order', async () => {
    const { create } = makeClient();
    pipeStdin(JSON.stringify([
      { asA: 'a', iWant: 'one', soThat: 'x' },
      { iWant: 'two', scopeId: 's1' },
      { iWant: 'three', acceptanceCriteria: 'done' },
    ]));

    await run(['add', '--feature', 'f1']);

    expect(create).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenNthCalledWith(1, {
      featureId: 'f1', asA: 'a', iWant: 'one', soThat: 'x',
      acceptanceCriteria: undefined, scopeId: undefined,
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      featureId: 'f1', asA: undefined, iWant: 'two', soThat: undefined,
      acceptanceCriteria: undefined, scopeId: 's1',
    });
  });

  it('reports per-item failure without aborting the rest', async () => {
    const { create } = makeClient();
    create
      .mockResolvedValueOnce({ id: 'ok1' })
      .mockRejectedValueOnce(new Error('bad story'))
      .mockResolvedValueOnce({ id: 'ok3' });
    pipeStdin(JSON.stringify([{ iWant: 'a' }, { iWant: 'b' }, { iWant: 'c' }]));

    const log = vi.spyOn(console, 'log');
    await run(['add', '--feature', 'f1']);

    expect(create).toHaveBeenCalledTimes(3);
    const out = log.mock.calls.map((c) => String(c[0])).join('\n');
    const summary = JSON.parse(out.trim());
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.results[1]).toMatchObject({ index: 1, ok: false });
    expect(summary.results[1].error).toContain('bad story');
  });
});

describe('features stories list', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  it('calls userStories.list with the feature id', async () => {
    const { list } = makeClient();
    await run(['list', '--feature', 'f1']);
    expect(list).toHaveBeenCalledWith({ featureId: 'f1' });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPageCommentsCommand } from './pageComments.js';
import * as clientModule from '../client/index.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

vi.mock('../utils/resolve.js', () => ({
  resolveWorkspaceId: vi.fn().mockResolvedValue('w1'),
}));

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    pageId: 'p1',
    threadId: null,
    parentId: null,
    body: 'hi',
    quotedText: null,
    resolvedAt: null,
    createdById: 'u1',
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
    createdBy: { id: 'u1', name: 'Agent', image: null },
    ...overrides,
  };
}

function makeClient() {
  const create = vi.fn().mockImplementation(async (input: Record<string, unknown>) =>
    makeComment({
      body: input.body,
      threadId: input.quotedText ? 't1' : null,
      quotedText: input.quotedText ?? null,
      anchor: { anchored: !!input.quotedText, fastForward: false },
    }),
  );
  const reply = vi.fn().mockResolvedValue(makeComment({ id: 'c2', parentId: 'c1' }));
  const resolve = vi.fn().mockResolvedValue({ success: true });
  const unresolve = vi.fn().mockResolvedValue({ success: true });
  const client = { pageComments: { create, reply, resolve, unresolve } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { create, reply, resolve, unresolve };
}

// Run args as if typed after `pages comment`.
async function run(args: string[]) {
  const cmd = createPageCommentsCommand();
  cmd.exitOverride();
  cmd.option('--json');
  await cmd.parseAsync(args, { from: 'user' });
}

describe('pages comment', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    log.mockRestore();
    vi.clearAllMocks();
  });

  it('add without --quote posts a doc-level comment', async () => {
    const { create } = makeClient();
    await run(['add', '--page', 'p1', '-m', 'hi']);
    expect(create).toHaveBeenCalledWith({ pageId: 'p1', body: 'hi' });
  });

  it('add --quote anchors, with prefix/suffix as quoteContext', async () => {
    const { create } = makeClient();
    await run([
      'add', '--page', 'p1', '-m', 'Which one?',
      '--quote', 'the indicator', '--quote-prefix', 'We pick ',
    ]);
    expect(create).toHaveBeenCalledWith({
      pageId: 'p1',
      body: 'Which one?',
      quotedText: 'the indicator',
      quoteContext: { prefix: 'We pick ', suffix: undefined },
    });
  });

  it('add --json reports the thread, the quote and the anchor outcome', async () => {
    makeClient();
    await run(['--json', 'add', '--page', 'p1', '-m', 'Which one?', '--quote', 'the indicator']);
    const out = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(out).toMatchObject({
      threadId: 't1',
      quotedText: 'the indicator',
      anchor: { anchored: true },
    });
  });

  it('refuses --quote-prefix without --quote before calling the API', async () => {
    const { create } = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run(['add', '--page', 'p1', '-m', 'hi', '--quote-prefix', 'x']);
    expect(create).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });

  it('reply, resolve and unresolve hit their endpoints', async () => {
    const { reply, resolve, unresolve } = makeClient();
    await run(['reply', '--comment-id', 'c1', '-m', 'agreed']);
    await run(['resolve', '--page', 'p1', '--thread', 't1']);
    await run(['unresolve', '--page', 'p1', '--thread', 't1']);
    expect(reply).toHaveBeenCalledWith({ parentId: 'c1', body: 'agreed' });
    expect(resolve).toHaveBeenCalledWith({ pageId: 'p1', threadId: 't1' });
    expect(unresolve).toHaveBeenCalledWith({ pageId: 'p1', threadId: 't1' });
  });
});

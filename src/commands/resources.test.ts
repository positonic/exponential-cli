import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createResourcesCommand, collectTags } from './resources.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

vi.mock('../utils/resolve.js', () => ({
  resolveWorkspaceId: vi.fn(),
  resolveProductId: vi.fn(),
}));

function makeResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    title: 'example.com',
    description: null,
    url: 'https://example.com/post',
    contentType: 'bookmark',
    wordCount: null,
    tags: [],
    pinnedAsContext: false,
    readStatus: 'to_read',
    readAt: null,
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    archivedAt: null,
    ...overrides,
  };
}

function makeClient() {
  const list = vi.fn().mockResolvedValue({ resources: [makeResource()] });
  const save = vi.fn().mockResolvedValue(makeResource());
  const setReadStatus = vi.fn().mockResolvedValue({ id: 'r1', readStatus: 'read', readAt: new Date() });
  const archive = vi.fn().mockResolvedValue({ success: true });
  const get = vi.fn().mockResolvedValue(makeResource({ tags: ['ai', 'thought leader'] }));
  const update = vi.fn().mockImplementation(async (id: string, input: Record<string, unknown>) =>
    makeResource({ id, ...input }),
  );
  const client = { resources: { list, save, setReadStatus, archive, get, update } };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('w1');
  return { list, save, setReadStatus, archive, get, update };
}

// Run args as if typed after `exponential resources`.
async function run(args: string[]) {
  const cmd = createResourcesCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

describe('resources', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    log.mockRestore();
    vi.clearAllMocks();
  });

  it('list defaults to the Reading list (unread) in the default workspace', async () => {
    const { list } = makeClient();
    await run(['list']);
    expect(list).toHaveBeenCalledWith({
      workspaceId: 'w1',
      readStatus: 'unread',
      search: undefined,
      limit: 50,
    });
  });

  it('list --status all drops the read filter; an unknown status is rejected before any call', async () => {
    const { list } = makeClient();
    await run(['list', '--status', 'all']);
    expect(list.mock.calls[0][0]).toMatchObject({ readStatus: undefined });

    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run(['list', '--status', 'bogus']);
    expect(list).toHaveBeenCalledTimes(1);
    exit.mockRestore();
    err.mockRestore();
  });

  it('create --url saves a to_read link with title and note', async () => {
    const { save } = makeClient();
    await run(['create', '--url', 'https://example.com/post', '-t', 'Essay', '--note', 'from Sam']);
    expect(save).toHaveBeenCalledWith({
      url: 'https://example.com/post',
      title: 'Essay',
      note: 'from Sam',
      workspaceId: 'w1',
      readStatus: 'to_read',
    });
  });

  it('create --read files reference material as already read', async () => {
    const { save } = makeClient();
    await run(['create', '--url', 'https://example.com/post', '--read']);
    expect(save.mock.calls[0][0]).toMatchObject({ readStatus: 'read' });
  });

  it('collectTags accepts repeats and commas, trimming and de-duplicating', () => {
    expect(collectTags('thought leader, ai', [])).toEqual(['thought leader', 'ai']);
    expect(collectTags('ai,,agents', ['thought leader', 'ai'])).toEqual(['thought leader', 'ai', 'agents']);
  });

  it('create --tag forwards tags to save; no --tag sends none', async () => {
    const { save } = makeClient();
    await run(['create', '--url', 'https://example.com/post', '--tag', 'thought leader', '--tag', 'ai,agents']);
    expect(save.mock.calls[0][0]).toMatchObject({ tags: ['thought leader', 'ai', 'agents'] });

    await run(['create', '--url', 'https://example.com/post']);
    expect(save.mock.calls[1][0].tags).toBeUndefined();
  });

  it('create --tag --json prints the saved tags', async () => {
    const { save } = makeClient();
    save.mockResolvedValueOnce(makeResource({ tags: ['thought leader'] }));
    await run(['create', '--url', 'https://example.com/post', '--tag', 'thought leader']);
    const out = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(out.tags).toEqual(['thought leader']);
  });

  it('list --tag filters by tag and echoes it in the JSON filters', async () => {
    const { list } = makeClient();
    await run(['list', '--tag', 'thought leader']);
    expect(list.mock.calls[0][0]).toMatchObject({ tags: ['thought leader'] });
    const out = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(out.filters).toEqual({ status: 'unread', tags: ['thought leader'] });
  });

  it('tag --add/--remove reads the current tags and writes the edited set', async () => {
    const { get, update } = makeClient();
    await run(['tag', 'r1', '--add', 'agents', '--add', 'ai', '--remove', 'thought leader']);
    expect(get).toHaveBeenCalledWith('r1');
    expect(update).toHaveBeenCalledWith('r1', { tags: ['ai', 'agents'] });
  });

  it('tag with neither --add nor --remove is rejected before any call', async () => {
    const { get, update } = makeClient();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run(['tag', 'r1']);
    expect(get).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });

  it('mark-read, unread and archive act on the id', async () => {
    const { setReadStatus, archive } = makeClient();
    await run(['mark-read', 'r1']);
    await run(['unread', 'r1']);
    await run(['archive', 'r1']);
    expect(setReadStatus).toHaveBeenNthCalledWith(1, 'r1', 'read');
    expect(setReadStatus).toHaveBeenNthCalledWith(2, 'r1', 'to_read');
    expect(archive).toHaveBeenCalledWith('r1');
  });
});

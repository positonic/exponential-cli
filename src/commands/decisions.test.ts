import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDecisionsCommand,
  parseDecider,
  parseEvidence,
  parseBatchFile,
  pickDecisionRef,
} from './decisions.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';
import { resetStdinGuardForTests } from '../utils/input.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

vi.mock('../utils/resolve.js', () => ({
  resolveWorkspaceId: vi.fn(),
  resolveWorkspace: vi.fn(),
  resolveProductId: vi.fn(),
}));

function makeDecision(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: 'ws1',
    number: 1,
    label: 'D-0001',
    statement: `Decision ${id}`,
    body: null,
    status: 'ACCEPTED',
    reviewState: 'CONFIRMED',
    source: 'MANUAL',
    decidedAt: null,
    ownerId: null,
    createdById: 'u1',
    confirmedById: 'u1',
    confirmedAt: new Date('2026-01-01'),
    transcriptionSessionId: null,
    occurrenceId: null,
    productId: null,
    projectId: null,
    goalId: null,
    keyResultId: null,
    supersededById: null,
    adrDocumentId: null,
    pendingAdrPrUrl: null,
    evidence: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: 'ws1',
    number: 1,
    label: 'D-0001',
    statement: `Decision ${id}`,
    status: 'ACCEPTED',
    source: 'MEETING',
    decidedAt: null,
    updatedAt: new Date('2026-01-01'),
    transcriptionSessionId: 'm1',
    occurrenceId: null,
    productId: null,
    projectId: null,
    supersededById: null,
    evidenceCount: 0,
    product: null,
    project: null,
    occurrence: null,
    transcriptionSession: { id: 'm1', title: 'Standup' },
    supersededBy: null,
    ...overrides,
  };
}

function makeClient() {
  const list = vi.fn().mockResolvedValue([]);
  const get = vi.fn().mockResolvedValue(makeDecision('d1'));
  const listForMeeting = vi
    .fn()
    .mockResolvedValue({ decisions: [], canLogDecision: true, workspaceId: 'ws1' });
  const listForAdr = vi.fn().mockResolvedValue([]);
  const extractDrafts = vi.fn().mockResolvedValue({
    success: true,
    alreadyPublished: false,
    alreadyDrafted: false,
    draftCount: 2,
    draftsCreated: 2,
    discardedWithoutEvidence: 0,
    errors: [],
  });
  const create = vi.fn().mockResolvedValue(makeDecision('d1'));
  const update = vi.fn().mockResolvedValue(makeDecision('d1'));
  const setStatus = vi.fn().mockResolvedValue(makeDecision('d1'));
  const linkTicket = vi.fn().mockResolvedValue({ id: 'l1', ticketId: 't1' });
  const linkFeature = vi.fn().mockResolvedValue({ id: 'l2', featureId: 'f1' });
  const unlink = vi.fn().mockResolvedValue({ deleted: true });
  const confirmDraft = vi.fn().mockResolvedValue(makeDecision('d1'));
  const rejectDraft = vi.fn().mockResolvedValue({ id: 'd1', reviewState: 'REJECTED' });
  const deleteDraft = vi.fn().mockResolvedValue({ id: 'd1' });
  const client = {
    decisions: {
      list, get, listForMeeting, listForAdr, extractDrafts, create, update, setStatus,
      linkTicket, linkFeature, unlink, confirmDraft, rejectDraft, deleteDraft,
    },
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    client as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  vi.mocked(resolveModule.resolveProductId).mockResolvedValue('prod1');
  return {
    list, get, listForMeeting, listForAdr, extractDrafts, create, update, setStatus,
    linkTicket, linkFeature, unlink, confirmDraft, rejectDraft, deleteDraft,
  };
}

async function run(args: string[]) {
  const cmd = createDecisionsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

function loggedText(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((c) => c.join(' '))
    .join('\n');
}

function writeTemp(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'exp-cli-test-'));
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetStdinGuardForTests();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  // The batch path sets process.exitCode on a partial failure. Left set, it
  // would make the whole vitest run exit non-zero.
  process.exitCode = 0;
});

describe('decisions list', () => {
  it('sends repeated --status as a statuses array', async () => {
    const { list } = makeClient();
    await run(['list', '--status', 'OPEN', '--status', 'accepted']);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', statuses: ['OPEN', 'ACCEPTED'] }),
    );
  });

  it('omits filters that were not given', async () => {
    const { list } = makeClient();
    await run(['list']);
    expect(list).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      statuses: undefined,
      sources: undefined,
      productId: undefined,
      includeWorkspaceWide: undefined,
      projectId: undefined,
      search: undefined,
    });
  });

  it('passes --product workspace through as the sentinel, unresolved', async () => {
    const { list } = makeClient();
    await run(['list', '--product', 'workspace']);
    expect(resolveModule.resolveProductId).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'workspace' }),
    );
  });

  it('resolves a real product slug to an id', async () => {
    const { list } = makeClient();
    await run(['list', '--product', 'alpha']);
    expect(resolveModule.resolveProductId).toHaveBeenCalledWith(
      expect.anything(),
      'ws1',
      'alpha',
    );
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ productId: 'prod1' }));
  });

  it('rejects an unknown status before calling the API', async () => {
    const { list } = makeClient();
    await expect(run(['list', '--status', 'MAYBE'])).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });

  it('routes --meeting through listForMeeting without needing a workspace', async () => {
    const { list, listForMeeting } = makeClient();
    await run(['list', '--meeting', 'm1']);
    expect(listForMeeting).toHaveBeenCalledWith('m1');
    expect(list).not.toHaveBeenCalled();
    expect(resolveModule.resolveWorkspaceId).not.toHaveBeenCalled();
  });

  it('filters meeting rows locally by status', async () => {
    const { listForMeeting } = makeClient();
    listForMeeting.mockResolvedValue({
      decisions: [
        makeRow('d1', { status: 'ACCEPTED' }),
        makeRow('d2', { status: 'OPEN', statement: 'Do we backfill?' }),
      ],
      canLogDecision: true,
      workspaceId: 'ws1',
    });

    await run(['list', '--meeting', 'm1', '--status', 'OPEN']);

    const payload = JSON.parse(loggedText()) as {
      total: number;
      decisions: { id: string; isOpenQuestion: boolean }[];
    };
    expect(payload.total).toBe(1);
    expect(payload.decisions[0]?.id).toBe('d2');
    expect(payload.decisions[0]?.isOpenQuestion).toBe(true);
  });

  it('reports canLogDecision alongside the meeting rows', async () => {
    const { listForMeeting } = makeClient();
    listForMeeting.mockResolvedValue({
      decisions: [],
      canLogDecision: false,
      workspaceId: null,
    });
    await run(['list', '--meeting', 'm1']);
    const payload = JSON.parse(loggedText()) as { canLogDecision: boolean };
    expect(payload.canLogDecision).toBe(false);
  });
});

describe('decisions list paging', () => {
  it('passes --number and --limit as integers', async () => {
    const { list } = makeClient();
    await run(['list', '--number', '3', '--limit', '50']);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ number: 3, limit: 50 }),
    );
  });

  it('rejects a non-numeric --limit before calling the API', async () => {
    const { list } = makeClient();
    await expect(run(['list', '--limit', 'lots'])).rejects.toThrow('process.exit(1)');
    expect(list).not.toHaveBeenCalled();
  });
});

describe('decisions create', () => {
  it('logs an open question as status OPEN attached to the meeting', async () => {
    const { create } = makeClient();
    await run([
      'create',
      '-s',
      'Do we backfill historical rows?',
      '--status',
      'open',
      '--meeting',
      'm1',
      '--source',
      'agent',
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        statement: 'Do we backfill historical rows?',
        status: 'OPEN',
        source: 'AGENT',
        transcriptionSessionId: 'm1',
      }),
    );
  });

  it('reads the Markdown body from a file', async () => {
    const { create } = makeClient();
    const file = writeTemp('body.md', '## Context\nWe measured it.\n');
    await run(['create', '-s', 'Ship it', '--body-file', file]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      body: '## Context\nWe measured it.\n',
    });
  });

  it('reads evidence from a JSON file', async () => {
    const { create } = makeClient();
    const file = writeTemp(
      'evidence.json',
      JSON.stringify([{ turnIndex: 3, speaker: 'Ada', startTime: 12.5, text: 'Agreed.' }]),
    );
    await run(['create', '-s', 'Ship it', '--meeting', 'm1', '--evidence-file', file]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      transcriptionSessionId: 'm1',
      evidence: [{ turnIndex: 3, speaker: 'Ada', startTime: 12.5, text: 'Agreed.' }],
    });
  });

  it('collects repeated --decider flags', async () => {
    const { create } = makeClient();
    await run([
      'create',
      '-s',
      'Ship it',
      '--decider',
      'Ada Lovelace <ada@example.com>',
      '--decider',
      'Grace',
    ]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      deciders: [
        { name: 'Ada Lovelace', email: 'ada@example.com' },
        { name: 'Grace' },
      ],
    });
  });

  it('refuses a create with neither --statement nor --from-file', async () => {
    const { create } = makeClient();
    await expect(run(['create'])).rejects.toThrow('process.exit(1)');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses --statement together with --from-file', async () => {
    const { create } = makeClient();
    const file = writeTemp('d.json', '[{"statement":"a"}]');
    await expect(run(['create', '-s', 'x', '--from-file', file])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe('decisions create --from-file', () => {
  it('creates every entry, applying the flags as defaults', async () => {
    const { create } = makeClient();
    const file = writeTemp(
      'batch.json',
      JSON.stringify([
        { statement: 'Ship behind a flag', status: 'ACCEPTED' },
        { statement: 'Do we backfill?', status: 'OPEN' },
      ]),
    );

    await run(['create', '--from-file', file, '--meeting', 'm1', '--source', 'AGENT']);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      statement: 'Ship behind a flag',
      status: 'ACCEPTED',
      source: 'AGENT',
      transcriptionSessionId: 'm1',
      workspaceId: 'ws1',
    });
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      statement: 'Do we backfill?',
      status: 'OPEN',
      transcriptionSessionId: 'm1',
    });
  });

  it('lets an entry override the shared defaults', async () => {
    const { create } = makeClient();
    const file = writeTemp(
      'batch.json',
      JSON.stringify([{ statement: 'From another meeting', meeting: 'm2' }]),
    );
    await run(['create', '--from-file', file, '--meeting', 'm1']);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ transcriptionSessionId: 'm2' });
  });

  it('accepts the {"decisions": [...]} envelope', async () => {
    const { create } = makeClient();
    const file = writeTemp(
      'batch.json',
      JSON.stringify({ decisions: [{ statement: 'One' }] }),
    );
    await run(['create', '--from-file', file]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps going past a failed entry, names it, and exits non-zero', async () => {
    const { create } = makeClient();
    create
      .mockResolvedValueOnce(makeDecision('d1'))
      .mockRejectedValueOnce(new Error('statement too long'))
      .mockResolvedValueOnce(makeDecision('d3'));
    const file = writeTemp(
      'batch.json',
      JSON.stringify([
        { statement: 'One' },
        { statement: 'Two' },
        { statement: 'Three' },
      ]),
    );

    await run(['create', '--from-file', file]);

    expect(create).toHaveBeenCalledTimes(3);
    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(loggedText()) as {
      succeeded: number;
      failed: number;
      results: { index: number; success: boolean; statement: string; error: string | null }[];
    };
    expect(payload.succeeded).toBe(2);
    expect(payload.failed).toBe(1);
    expect(payload.results[1]).toMatchObject({
      index: 1,
      success: false,
      statement: 'Two',
      error: 'statement too long',
    });
  });

  it('exits zero when every entry lands', async () => {
    makeClient();
    const file = writeTemp('batch.json', JSON.stringify([{ statement: 'One' }]));
    await run(['create', '--from-file', file]);
    expect(process.exitCode).not.toBe(1);
  });

  it('rejects a file whose entries have no statement', async () => {
    const { create } = makeClient();
    const file = writeTemp('batch.json', JSON.stringify([{ body: 'orphan' }]));
    await expect(run(['create', '--from-file', file])).rejects.toThrow('process.exit(1)');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('evidence needs a meeting', () => {
  // The server rejects evidence without a transcriptionSessionId, and
  // silently drops quotes that aren't in that meeting's transcript. Catching
  // the first case here gives a message that says why.
  it('refuses --evidence-file without --meeting', async () => {
    const { create } = makeClient();
    const file = writeTemp('evidence.json', '[{"turnIndex":1,"text":"hi"}]');
    await expect(
      run(['create', '-s', 'Ship it', '--evidence-file', file]),
    ).rejects.toThrow('process.exit(1)');
    expect(create).not.toHaveBeenCalled();
  });

  it('fails just the batch entry that carries evidence with no meeting', async () => {
    const { create } = makeClient();
    const file = writeTemp(
      'batch.json',
      JSON.stringify([
        { statement: 'Fine without evidence' },
        { statement: 'Cites a transcript', evidence: [{ turnIndex: 1, text: 'hi' }] },
      ]),
    );

    await run(['create', '--from-file', file]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(loggedText()) as {
      failed: number;
      results: { index: number; error: string | null }[];
    };
    expect(payload.failed).toBe(1);
    expect(payload.results[1]?.error).toContain('--meeting');
  });

  it('allows evidence when the meeting comes from the flag', async () => {
    const { create } = makeClient();
    const file = writeTemp(
      'batch.json',
      JSON.stringify([
        { statement: 'Cites a transcript', evidence: [{ turnIndex: 1, text: 'hi' }] },
      ]),
    );
    await run(['create', '--from-file', file, '--meeting', 'm1']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(process.exitCode).not.toBe(1);
  });
});

describe('decisions draft extract', () => {
  it('extracts drafts for one meeting', async () => {
    const { extractDrafts } = makeClient();
    await run(['draft', 'extract', '--meeting', 'm1']);
    expect(extractDrafts).toHaveBeenCalledWith('m1');
  });
});

describe('decisions create --from-file shared flags', () => {
  it('applies --decider to entries that name none', async () => {
    const { create } = makeClient();
    const file = writeTemp('batch.json', JSON.stringify([{ statement: 'One' }]));
    await run(['create', '--from-file', file, '--decider', 'Ada <ada@example.com>']);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      deciders: [{ name: 'Ada', email: 'ada@example.com' }],
    });
  });

  it("lets an entry's own deciders win over the flag", async () => {
    const { create } = makeClient();
    const file = writeTemp(
      'batch.json',
      JSON.stringify([{ statement: 'One', deciders: ['Grace'] }]),
    );
    await run(['create', '--from-file', file, '--decider', 'Ada <ada@example.com>']);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ deciders: [{ name: 'Grace' }] });
  });

  it('refuses per-decision content flags rather than ignoring them', async () => {
    const { create } = makeClient();
    const batch = writeTemp('batch.json', JSON.stringify([{ statement: 'One' }]));
    const body = writeTemp('body.md', '# shared?');
    await expect(
      run(['create', '--from-file', batch, '--body-file', body]),
    ).rejects.toThrow('process.exit(1)');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('decisions create --from-file validation', () => {
  it('rejects an unknown field instead of dropping it', () => {
    expect(() =>
      parseBatchFile('[{"statement":"One","decider":"Ada"}]'),
    ).toThrow('decider');
  });

  it('rejects a goalId written as a string', () => {
    expect(() => parseBatchFile('[{"statement":"One","goalId":"12"}]')).toThrow(
      'must be a number',
    );
  });

  it('accepts every documented field', () => {
    const entry = {
      statement: 'One',
      body: 'why',
      status: 'OPEN',
      source: 'AGENT',
      meeting: 'm1',
      transcriptionSessionId: 'm1',
      productId: 'p1',
      projectId: 'pr1',
      goalId: 12,
      keyResultId: 'kr1',
      occurrenceId: 'o1',
      decidedAt: '2026-09-10',
      ownerId: 'u1',
      deciders: ['Ada'],
      evidence: [{ turnIndex: 1, text: 'hi' }],
    };
    expect(parseBatchFile(JSON.stringify([entry]))).toHaveLength(1);
  });
});

describe('decisions list --adr', () => {
  it('queries the ADR alone, without the discarded log query', async () => {
    const { list, listForAdr } = makeClient();
    await run(['list', '--adr', 'adr1']);
    expect(listForAdr).toHaveBeenCalledWith('ws1', 'adr1');
    expect(list).not.toHaveBeenCalled();
  });
});

describe('decisions update', () => {
  it('refuses an update with no fields', async () => {
    const { update } = makeClient();
    await expect(run(['update', '--id', 'd1'])).rejects.toThrow('process.exit(1)');
    expect(update).not.toHaveBeenCalled();
  });

  it('sends only the fields given, and clears with "null"', async () => {
    const { update } = makeClient();
    await run(['update', '--id', 'd1', '--body', 'null', '--owner', 'u2']);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        decisionId: 'd1',
        body: null,
        ownerId: 'u2',
        statement: undefined,
      }),
    );
  });

  it('detaches a product with "null" instead of resolving it', async () => {
    const { update } = makeClient();
    await run(['update', '--id', 'd1', '--product', 'null']);
    expect(resolveModule.resolveProductId).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ productId: null }));
  });
});

describe('decisions status', () => {
  it('answers an open question by moving it to ACCEPTED', async () => {
    const { setStatus } = makeClient();
    await run(['status', '--id', 'd1', '--status', 'accepted']);
    expect(setStatus).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      decisionId: 'd1',
      status: 'ACCEPTED',
      supersededById: undefined,
    });
  });

  it('refuses SUPERSEDED without --superseded-by', async () => {
    const { setStatus } = makeClient();
    await expect(
      run(['status', '--id', 'd1', '--status', 'SUPERSEDED']),
    ).rejects.toThrow('process.exit(1)');
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe('decisions link / unlink', () => {
  it('links a ticket', async () => {
    const { linkTicket } = makeClient();
    await run(['link', '--id', 'd1', '--ticket', 't1']);
    expect(linkTicket).toHaveBeenCalledWith('ws1', 'd1', 't1');
  });

  it('refuses both --ticket and --feature', async () => {
    const { linkTicket, linkFeature } = makeClient();
    await expect(
      run(['link', '--id', 'd1', '--ticket', 't1', '--feature', 'f1']),
    ).rejects.toThrow('process.exit(1)');
    expect(linkTicket).not.toHaveBeenCalled();
    expect(linkFeature).not.toHaveBeenCalled();
  });

  it('refuses a link with neither', async () => {
    const { linkTicket } = makeClient();
    await expect(run(['link', '--id', 'd1'])).rejects.toThrow('process.exit(1)');
    expect(linkTicket).not.toHaveBeenCalled();
  });

  it('unlinks by link id', async () => {
    const { unlink } = makeClient();
    await run(['unlink', '--link', 'l1']);
    expect(unlink).toHaveBeenCalledWith('ws1', 'l1');
  });
});

describe('decisions draft', () => {
  it('confirms, rejects and deletes a draft', async () => {
    const { confirmDraft, rejectDraft, deleteDraft } = makeClient();
    await run(['draft', 'confirm', '--id', 'd1']);
    await run(['draft', 'reject', '--id', 'd1']);
    await run(['draft', 'delete', '--id', 'd1']);
    expect(confirmDraft).toHaveBeenCalledWith('ws1', 'd1');
    expect(rejectDraft).toHaveBeenCalledWith('ws1', 'd1');
    expect(deleteDraft).toHaveBeenCalledWith('ws1', 'd1');
  });
});

describe('help text', () => {
  it('says an open question is a decision with status OPEN', () => {
    const help = createDecisionsCommand().helpInformation();
    expect(help).toContain('OPEN QUESTION');
  });
});

describe('parseDecider', () => {
  it('splits "Name <email>"', () => {
    expect(parseDecider('Ada Lovelace <ada@example.com>')).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
  });

  it('names an email-only decider by its address', () => {
    expect(parseDecider('ada@example.com')).toEqual({
      name: 'ada@example.com',
      email: 'ada@example.com',
    });
    expect(parseDecider('<ada@example.com>')).toEqual({
      name: 'ada@example.com',
      email: 'ada@example.com',
    });
  });

  it('accepts a bare name for an external participant with no account', () => {
    expect(parseDecider('Grace Hopper')).toEqual({ name: 'Grace Hopper' });
  });

  it('rejects an empty decider', () => {
    expect(() => parseDecider('   ')).toThrow();
  });
});

describe('parseEvidence', () => {
  it('normalizes optional fields to null', () => {
    expect(parseEvidence('[{"turnIndex":1,"text":"hi"}]')).toEqual([
      { turnIndex: 1, speaker: null, startTime: null, text: 'hi' },
    ]);
  });

  it('rejects anything that is not an array of turns', () => {
    expect(() => parseEvidence('{"turnIndex":1}')).toThrow('array');
    expect(() => parseEvidence('[{"text":"no index"}]')).toThrow('turnIndex');
    expect(() => parseEvidence('not json')).toThrow('JSON');
  });
});

describe('parseBatchFile', () => {
  it('rejects an empty array rather than silently doing nothing', () => {
    expect(() => parseBatchFile('[]')).toThrow('no decisions');
  });

  it('rejects a blank statement', () => {
    expect(() => parseBatchFile('[{"statement":"  "}]')).toThrow('statement');
  });
});

describe('D-number labels', () => {
  it('resolves D-0006 to its id through list --number', async () => {
    const { list, get } = makeClient();
    list.mockResolvedValue([makeRow('cuid6', { number: 6, label: 'D-0006' })]);
    await run(['get', 'D-0006']);
    expect(list).toHaveBeenCalledWith({ workspaceId: 'ws1', number: 6, limit: 1 });
    expect(get).toHaveBeenCalledWith('ws1', 'cuid6');
  });

  it('accepts lower case and unpadded numbers', async () => {
    const { list, get } = makeClient();
    list.mockResolvedValue([makeRow('cuid12', { number: 12 })]);
    await run(['get', 'd-12']);
    expect(list).toHaveBeenCalledWith({ workspaceId: 'ws1', number: 12, limit: 1 });
    expect(get).toHaveBeenCalledWith('ws1', 'cuid12');
  });

  it('passes an id straight through without a lookup', async () => {
    const { list, get } = makeClient();
    await run(['get', 'cmabc123']);
    expect(list).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith('ws1', 'cmabc123');
  });

  it('says drafts are not listed when the label is not found', async () => {
    const { get } = makeClient();
    await expect(run(['get', 'D-0099'])).rejects.toThrow('process.exit(1)');
    expect(get).not.toHaveBeenCalled();
    expect(loggedText()).toContain('Drafts are not listed');
  });

  it('resolves labels on update, status and link too', async () => {
    const { list, update, setStatus, linkFeature } = makeClient();
    list.mockResolvedValue([makeRow('cuid6', { number: 6 })]);
    await run(['update', 'D-0006', '-s', 'Resolved']);
    await run(['status', 'D-0006', '--status', 'DEPRECATED']);
    await run(['link', 'D-0006', '--feature', 'f1']);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ decisionId: 'cuid6', statement: 'Resolved' });
    expect(setStatus.mock.calls[0]?.[0]).toMatchObject({ decisionId: 'cuid6', status: 'DEPRECATED' });
    expect(linkFeature).toHaveBeenCalledWith('ws1', 'cuid6', 'f1');
  });

  it('keeps the --id flag working', async () => {
    const { update } = makeClient();
    await run(['update', '--id', 'd1', '-s', 'Still works']);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ decisionId: 'd1' });
  });

  it('refuses two different ids', () => {
    expect(() => pickDecisionRef('D-0001', 'd2')).toThrow('two decisions');
    expect(pickDecisionRef('d2', 'd2')).toBe('d2');
    expect(() => pickDecisionRef(undefined, undefined)).toThrow('D-number');
  });
});

describe('decisions status --superseded-by', () => {
  it('resolves a D-number for the successor too', async () => {
    const { list, setStatus } = makeClient();
    list.mockImplementation(async ({ number }: { number: number }) => [
      makeRow(`cuid${number}`, { number }),
    ]);
    await run(['status', 'D-0006', '--status', 'SUPERSEDED', '--superseded-by', 'D-0009']);
    expect(setStatus.mock.calls[0]?.[0]).toMatchObject({
      decisionId: 'cuid6',
      supersededById: 'cuid9',
    });
  });
});

describe('decisions set-status', () => {
  it('is an alias of status', async () => {
    const { setStatus } = makeClient();
    await run(['set-status', 'd1', '--status', 'accepted']);
    expect(setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', decisionId: 'd1', status: 'ACCEPTED' }),
    );
  });
});

describe('decisions create --feature', () => {
  it('links the new decision to the feature', async () => {
    const { create, linkFeature } = makeClient();
    create.mockResolvedValue(makeDecision('d7', { status: 'OPEN', label: 'D-0007' }));
    await run(['create', '-s', 'Which store?', '--status', 'OPEN', '--feature', 'f1']);
    expect(linkFeature).toHaveBeenCalledWith('ws1', 'd7', 'f1');
    const payload = JSON.parse(loggedText()) as { id: string; featureLink: { id: string } };
    expect(payload.id).toBe('d7');
    expect(payload.featureLink.id).toBe('l2');
  });

  it('does not link without --feature', async () => {
    const { linkFeature } = makeClient();
    await run(['create', '-s', 'No feature']);
    expect(linkFeature).not.toHaveBeenCalled();
    expect(JSON.parse(loggedText())).not.toHaveProperty('featureLink');
  });

  it('names the logged decision when the link fails, so a retry does not duplicate it', async () => {
    const { create, linkFeature } = makeClient();
    create.mockResolvedValue(makeDecision('d7', { label: 'D-0007' }));
    linkFeature.mockRejectedValue(new Error('Feature not found'));
    await expect(run(['create', '-s', 'x', '--feature', 'nope'])).rejects.toThrow(
      'process.exit(1)',
    );
    const text = loggedText();
    expect(text).toContain('Logged D-0007 (d7)');
    expect(text).toContain('exponential decisions link d7 --feature nope');
  });

  it('links every entry of a batch and fails just the entry whose link fails', async () => {
    const { create, linkFeature } = makeClient();
    create
      .mockResolvedValueOnce(makeDecision('d1'))
      .mockResolvedValueOnce(makeDecision('d2', { label: 'D-0002' }));
    linkFeature.mockResolvedValueOnce({ id: 'l1' }).mockRejectedValueOnce(new Error('boom'));
    const file = writeTemp('b.json', JSON.stringify([{ statement: 'A' }, { statement: 'B' }]));
    await run(['create', '--from-file', file, '--feature', 'f1']);
    expect(linkFeature).toHaveBeenNthCalledWith(1, 'ws1', 'd1', 'f1');
    expect(linkFeature).toHaveBeenNthCalledWith(2, 'ws1', 'd2', 'f1');
    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(loggedText()) as {
      results: { success: boolean; error: string | null }[];
    };
    expect(payload.results[0]?.success).toBe(true);
    expect(payload.results[1]?.success).toBe(false);
    expect(payload.results[1]?.error).toContain('Logged D-0002 (d2)');
  });
});

describe('decisions confirm', () => {
  it('confirms a draft by label and accepts it in one command', async () => {
    const { list, confirmDraft, setStatus } = makeClient();
    list.mockResolvedValue([makeRow('d1', { number: 1 })]);
    confirmDraft.mockResolvedValue(makeDecision('d1', { status: 'OPEN' }));
    setStatus.mockResolvedValue(makeDecision('d1', { status: 'ACCEPTED' }));
    await run(['confirm', 'D-0001', '--status', 'accepted']);
    expect(confirmDraft).toHaveBeenCalledWith('ws1', 'd1');
    expect(setStatus).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      decisionId: 'd1',
      status: 'ACCEPTED',
    });
    expect(JSON.parse(loggedText())).toMatchObject({ id: 'd1', status: 'ACCEPTED' });
  });

  it('skips the status write when the decision already has it', async () => {
    const { confirmDraft, setStatus } = makeClient();
    confirmDraft.mockResolvedValue(makeDecision('d1', { status: 'ACCEPTED' }));
    await run(['confirm', 'd1', '--status', 'ACCEPTED']);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('sets the status on the decision confirm returned (a resolution draft lands on its target)', async () => {
    const { confirmDraft, setStatus } = makeClient();
    confirmDraft.mockResolvedValue(makeDecision('target', { status: 'OPEN' }));
    await run(['confirm', 'draft1', '--status', 'ACCEPTED']);
    expect(setStatus.mock.calls[0]?.[0]).toMatchObject({ decisionId: 'target' });
  });

  it('only confirms without --status', async () => {
    const { confirmDraft, setStatus } = makeClient();
    await run(['confirm', 'd1']);
    expect(confirmDraft).toHaveBeenCalledWith('ws1', 'd1');
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('refuses SUPERSEDED before writing anything', async () => {
    const { confirmDraft } = makeClient();
    await expect(run(['confirm', 'd1', '--status', 'SUPERSEDED'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(confirmDraft).not.toHaveBeenCalled();
  });

  it('says the decision is confirmed when the status write fails', async () => {
    const { confirmDraft, setStatus } = makeClient();
    confirmDraft.mockResolvedValue(makeDecision('d1', { status: 'OPEN', label: 'D-0001' }));
    setStatus.mockRejectedValue(new Error('nope'));
    await expect(run(['confirm', 'd1', '--status', 'ACCEPTED'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(loggedText()).toContain('Confirmed D-0001, but it is still OPEN');
  });

  it('still works as draft confirm --id', async () => {
    const { confirmDraft } = makeClient();
    await run(['draft', 'confirm', '--id', 'd1']);
    expect(confirmDraft).toHaveBeenCalledWith('ws1', 'd1');
  });

  it('takes a positional id on draft reject and delete', async () => {
    const { rejectDraft, deleteDraft } = makeClient();
    await run(['draft', 'reject', 'd1']);
    await run(['draft', 'delete', 'd2']);
    expect(rejectDraft).toHaveBeenCalledWith('ws1', 'd1');
    expect(deleteDraft).toHaveBeenCalledWith('ws1', 'd2');
  });
});

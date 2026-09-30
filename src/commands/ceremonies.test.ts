import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCeremoniesCommand, parseCeremonyRef } from './ceremonies.js';
import * as clientModule from '../client/index.js';
import * as resolveModule from '../utils/resolve.js';
import { resetStdinGuardForTests } from '../utils/input.js';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

vi.mock('../utils/resolve.js', () => ({
  resolveWorkspaceId: vi.fn(),
}));

const CEREMONY_ID = 'cmtx5od3l0005l90473g4g6pr';
const OCCURRENCE_ID = 'cmu71po70003cl504vq1a9i95';
const URL = `https://www.exponential.im/w/syntrofi/ceremonies/${CEREMONY_ID}/${OCCURRENCE_ID}`;

function makeOccurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: OCCURRENCE_ID,
    ceremonyId: CEREMONY_ID,
    workspaceId: 'ws1',
    scheduledStart: new Date('2026-10-02T13:30:00Z'),
    scheduledEnd: new Date('2026-10-02T14:30:00Z'),
    status: 'PLANNED',
    skipReason: null,
    definitionSnapshot: {},
    agenda: null,
    agendaGeneratedAt: null,
    agendaCirculatedAt: null,
    scheduledMeetingId: null,
    previousOccurrenceId: null,
    notesPageId: 'page1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ceremony: {
      id: CEREMONY_ID,
      name: 'Leadership Weekly',
      kind: 'CUSTOM',
      timezone: 'Europe/Berlin',
      durationMinutes: 60,
      leadTimeHours: 24,
      ownerId: 'u1',
      matrixRoomId: null,
      agendaTemplate: [],
      owner: { id: 'u1', name: 'James', email: null },
    },
    recordedMeetings: [],
    canGenerate: true,
    skipProposal: { proposed: false, reason: 'not-async' },
    ...overrides,
  };
}

const standupUpdate = {
  questions: [{ key: 'done', prompt: 'Done?', placeholder: '', draftFrom: [] }],
  draftAnswers: {},
  answers: { done: 'Shipped it', today: 'Old plan' },
  draftedAt: null,
  submittedAt: null,
  flaggedBlocker: false,
  isParticipant: true,
};

function makeClient() {
  const ceremonies = {
    list: vi.fn().mockResolvedValue([
      { id: CEREMONY_ID, slug: 'leadership-weekly', name: 'Leadership Weekly' },
    ]),
    get: vi.fn().mockResolvedValue({ id: CEREMONY_ID }),
    templates: vi.fn().mockResolvedValue([
      {
        kind: 'STANDUP',
        name: 'Daily Standup',
        slug: 'daily-standup',
        aliases: ['Standup'],
        purpose: 'p',
        notFor: 'n',
        inputs: 'i',
        outputs: 'o',
        cadenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30',
        durationMinutes: 15,
        leadTimeHours: 12,
        agendaTemplate: [],
      },
    ]),
    listOccurrences: vi.fn().mockResolvedValue([]),
    getOccurrence: vi.fn().mockResolvedValue(makeOccurrence()),
    updateSummary: vi.fn().mockResolvedValue({
      questions: [],
      participants: [],
      submittedCount: 0,
      blockedCount: 0,
    }),
    myUpdate: vi.fn().mockResolvedValue(standupUpdate),
    draftMyUpdate: vi.fn().mockResolvedValue(standupUpdate),
    saveMyUpdate: vi.fn().mockResolvedValue(standupUpdate),
    generateAgenda: vi.fn(),
    skipOccurrence: vi.fn().mockResolvedValue({ id: OCCURRENCE_ID, status: 'SKIPPED', skipReason: 'x' }),
    unskipOccurrence: vi.fn(),
    resolveAgendaItem: vi.fn().mockResolvedValue({ occurrenceId: OCCURRENCE_ID, agenda: null }),
    addAgendaItem: vi.fn(),
    create: vi.fn().mockResolvedValue({
      ceremony: { id: 'c2', name: 'Daily Standup', slug: 'daily-standup' },
      occurrencesCreated: 5,
    }),
    update: vi.fn().mockResolvedValue({
      ceremony: { id: CEREMONY_ID, name: 'Leadership Weekly', slug: 'leadership-weekly' },
      occurrencesCreated: 0,
    }),
    importDefinitions: vi.fn(),
    backfillAttachments: vi.fn().mockResolvedValue({
      dryRun: true,
      occurrencesCreated: 0,
      scanned: 0,
      matched: 0,
      rows: [],
    }),
    attachMeeting: vi.fn().mockResolvedValue({ meetingId: 'm1', occurrenceId: OCCURRENCE_ID }),
    detachMeeting: vi.fn(),
  };
  const decisions = {
    list: vi.fn().mockResolvedValue([
      { id: 'd1', occurrenceId: OCCURRENCE_ID, status: 'OPEN', label: 'D-0001', statement: 'Q?' },
      { id: 'd2', occurrenceId: 'other', status: 'ACCEPTED', label: 'D-0002', statement: 'No' },
    ]),
  };
  const pages = { get: vi.fn().mockResolvedValue({ id: 'page1', title: 'Notes', body: '# Notes' }) };
  vi.mocked(clientModule.getClient).mockReturnValue(
    { ceremonies, decisions, pages } as unknown as ReturnType<typeof clientModule.getClient>,
  );
  vi.mocked(resolveModule.resolveWorkspaceId).mockResolvedValue('ws1');
  return { ceremonies, decisions, pages };
}

async function run(args: string[]) {
  const cmd = createCeremoniesCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

function jsonOutput(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls;
  return JSON.parse(String(calls[calls.length - 1]![0])) as Record<string, unknown>;
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

describe('parseCeremonyRef', () => {
  it('reads an occurrence URL', () => {
    expect(parseCeremonyRef(URL)).toEqual({
      workspaceSlug: 'syntrofi',
      ceremonyId: CEREMONY_ID,
      occurrenceId: OCCURRENCE_ID,
      id: OCCURRENCE_ID,
    });
  });

  it('reads a ceremony URL, ignoring query and hash', () => {
    const ref = parseCeremonyRef(`https://www.exponential.im/w/syntrofi/ceremonies/${CEREMONY_ID}?tab=x#y`);
    expect(ref).toEqual({ workspaceSlug: 'syntrofi', ceremonyId: CEREMONY_ID, occurrenceId: undefined, id: CEREMONY_ID });
  });

  it('passes a bare id through', () => {
    expect(parseCeremonyRef(OCCURRENCE_ID)).toEqual({ id: OCCURRENCE_ID });
  });
});

describe('ceremonies list / get', () => {
  it('lists active ceremonies by default', async () => {
    const { ceremonies } = makeClient();
    await run(['list']);
    expect(ceremonies.list).toHaveBeenCalledWith('ws1', { includeInactive: undefined });
    expect(jsonOutput()).toMatchObject({ total: 1, workspaceId: 'ws1' });
  });

  it('resolves a slug to an id', async () => {
    const { ceremonies } = makeClient();
    await run(['get', 'leadership-weekly']);
    expect(ceremonies.list).toHaveBeenCalledWith('ws1', { includeInactive: true });
    expect(ceremonies.get).toHaveBeenCalledWith('ws1', CEREMONY_ID);
  });

  it('takes an id without a list round trip', async () => {
    const { ceremonies } = makeClient();
    await run(['get', CEREMONY_ID]);
    expect(ceremonies.list).not.toHaveBeenCalled();
    expect(ceremonies.get).toHaveBeenCalledWith('ws1', CEREMONY_ID);
  });

  it('uses the workspace slug from a pasted URL', async () => {
    const { ceremonies } = makeClient();
    await run(['get', URL, '--workspace', 'ignored']);
    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalledWith(expect.anything(), 'syntrofi');
    expect(ceremonies.get).toHaveBeenCalledWith('ws1', CEREMONY_ID);
  });
});

describe('ceremonies occurrences get', () => {
  it('fetches the occurrence from its URL', async () => {
    const { ceremonies, pages, decisions } = makeClient();
    await run(['occurrences', 'get', URL]);
    expect(resolveModule.resolveWorkspaceId).toHaveBeenCalledWith(expect.anything(), 'syntrofi');
    expect(ceremonies.getOccurrence).toHaveBeenCalledWith('ws1', OCCURRENCE_ID);
    expect(pages.get).not.toHaveBeenCalled();
    expect(decisions.list).not.toHaveBeenCalled();
    expect(jsonOutput()).not.toHaveProperty('notes');
  });

  it('--notes and --decisions pull in the notes page and this occurrence\'s decisions only', async () => {
    const { pages } = makeClient();
    await run(['occurrences', 'get', OCCURRENCE_ID, '--notes', '--decisions']);
    expect(pages.get).toHaveBeenCalledWith('page1');
    const out = jsonOutput();
    expect(out.notes).toMatchObject({ body: '# Notes' });
    expect((out.decisions as Array<{ id: string }>).map((d) => d.id)).toEqual(['d1']);
  });

  it('--notes on an occurrence without a notes page reports null', async () => {
    const { ceremonies, pages } = makeClient();
    ceremonies.getOccurrence.mockResolvedValue(makeOccurrence({ notesPageId: null }));
    await run(['occurrences', 'get', OCCURRENCE_ID, '--notes']);
    expect(pages.get).not.toHaveBeenCalled();
    expect(jsonOutput().notes).toBeNull();
  });
});

describe('ceremonies occurrences list', () => {
  it('defaults to 14 days either side of now', async () => {
    const { ceremonies } = makeClient();
    const before = Date.now();
    await run(['occurrences', 'list']);
    const input = ceremonies.listOccurrences.mock.calls[0]![0] as { from: Date; to: Date };
    const day = 24 * 60 * 60 * 1000;
    expect(Math.round((before - input.from.getTime()) / day)).toBe(14);
    expect(Math.round((input.to.getTime() - before) / day)).toBe(14);
  });

  it('resolves --ceremony by slug', async () => {
    const { ceremonies } = makeClient();
    await run(['occurrences', 'list', '--ceremony', 'leadership-weekly', '--from', '2026-09-01', '--to', '2026-10-01']);
    expect(ceremonies.listOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', ceremonyId: CEREMONY_ID }),
    );
  });
});

describe('ceremonies occurrences my-update', () => {
  it('reads without writing when no write flags are given', async () => {
    const { ceremonies } = makeClient();
    await run(['occurrences', 'my-update', OCCURRENCE_ID]);
    expect(ceremonies.myUpdate).toHaveBeenCalledWith('ws1', OCCURRENCE_ID);
    expect(ceremonies.saveMyUpdate).not.toHaveBeenCalled();
  });

  it('merges --answer over the saved answers and submits', async () => {
    const { ceremonies } = makeClient();
    await run(['occurrences', 'my-update', OCCURRENCE_ID, '--answer', 'today=Review = PRs', '--submit']);
    expect(ceremonies.saveMyUpdate).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      occurrenceId: OCCURRENCE_ID,
      answers: { done: 'Shipped it', today: 'Review = PRs' },
      submit: true,
    });
  });

  it('--no-blocker clears the flag; --reopen sends submit false', async () => {
    const { ceremonies } = makeClient();
    await run(['occurrences', 'my-update', OCCURRENCE_ID, '--no-blocker', '--reopen']);
    expect(ceremonies.saveMyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ flaggedBlocker: false, submit: false }),
    );
  });
});

describe('ceremonies writes', () => {
  it('create requires name, cadence, timezone and start', async () => {
    const { ceremonies } = makeClient();
    await expect(run(['create', '--name', 'X'])).rejects.toThrow('process.exit(1)');
    expect(ceremonies.create).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).toContain('--cadence, --timezone, --starts-on');
  });

  it('create from a template lets flags override it', async () => {
    const { ceremonies } = makeClient();
    await run([
      'create',
      '--template', 'daily-standup',
      '--timezone', 'Europe/Madrid',
      '--starts-on', '2026-10-05',
      '--duration', '20',
      '--participant', 'u1',
      '--participant', 'u2',
    ]);
    expect(ceremonies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        kind: 'STANDUP',
        name: 'Daily Standup',
        cadenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30',
        timezone: 'Europe/Madrid',
        durationMinutes: 20,
        participantUserIds: ['u1', 'u2'],
      }),
    );
  });

  it('update sends only the flags given', async () => {
    const { ceremonies } = makeClient();
    await run(['update', 'leadership-weekly', '--duration', '45', '--no-include-projects']);
    expect(ceremonies.update).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      id: CEREMONY_ID,
      durationMinutes: 45,
      includeProjects: false,
    });
  });

  it('update --inactive retires the ceremony', async () => {
    const { ceremonies } = makeClient();
    await run(['update', CEREMONY_ID, '--inactive']);
    expect(ceremonies.update).toHaveBeenCalledWith({ workspaceId: 'ws1', id: CEREMONY_ID, isActive: false });
  });

  it('update with no field flags is refused', async () => {
    const { ceremonies } = makeClient();
    await expect(run(['update', CEREMONY_ID])).rejects.toThrow('process.exit(1)');
    expect(ceremonies.update).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range duration', async () => {
    const { ceremonies } = makeClient();
    await expect(run(['update', CEREMONY_ID, '--duration', '2'])).rejects.toThrow('process.exit(1)');
    expect(ceremonies.update).not.toHaveBeenCalled();
  });

  it('skip passes the reason', async () => {
    const { ceremonies } = makeClient();
    await run(['occurrences', 'skip', URL, '--reason', 'Nothing to discuss']);
    expect(ceremonies.skipOccurrence).toHaveBeenCalledWith('ws1', OCCURRENCE_ID, 'Nothing to discuss');
  });

  it('agenda resolve --reopen sends resolved false', async () => {
    const { ceremonies } = makeClient();
    await run(['occurrences', 'agenda', 'resolve', OCCURRENCE_ID, 'item1', '--reopen']);
    expect(ceremonies.resolveAgendaItem).toHaveBeenCalledWith('ws1', OCCURRENCE_ID, 'item1', false);
  });

  it('attach takes the occurrence from a URL', async () => {
    const { ceremonies } = makeClient();
    await run(['occurrences', 'attach', URL, '--meeting', 'm1']);
    expect(ceremonies.attachMeeting).toHaveBeenCalledWith('m1', OCCURRENCE_ID);
  });

  it('backfill is a dry run unless --apply', async () => {
    const { ceremonies } = makeClient();
    await run(['backfill']);
    expect(ceremonies.backfillAttachments).toHaveBeenLastCalledWith('ws1', { dryRun: true });
    await run(['backfill', '--apply']);
    expect(ceremonies.backfillAttachments).toHaveBeenLastCalledWith('ws1', { dryRun: false });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import type { Pipeline } from 'exponential-sdk';
import { matchPipeline, matchStage, resolvePipeline } from './pipelines.js';
import * as inputModule from './input.js';

vi.mock('./input.js', () => ({
  selectOption: vi.fn(),
}));

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'cmtv8ufge0001gu04f9dz1irm',
    name: 'Close 3 paying clients by Dec 2026',
    workspaceId: 'ws1',
    status: 'ACTIVE',
    pipelineStages: [],
    ...overrides,
  };
}

const SALES = makePipeline({ id: 'cmoldpipe0000000000000001', name: 'Sales' });
const CLOSE3 = makePipeline();

describe('matchPipeline', () => {
  it('matches a bare id', () => {
    expect(matchPipeline([SALES, CLOSE3], CLOSE3.id)).toBe(CLOSE3);
  });

  // The web app's project URLs carry `<slug>-<cuid>`; users paste those.
  it('matches a slug-prefixed id by its trailing CUID', () => {
    expect(matchPipeline([SALES, CLOSE3], `close_3-${CLOSE3.id}`)).toBe(CLOSE3);
  });

  it('matches a name case-insensitively', () => {
    expect(matchPipeline([SALES, CLOSE3], 'sales')).toBe(SALES);
    expect(matchPipeline([SALES, CLOSE3], 'CLOSE 3 PAYING CLIENTS BY DEC 2026')).toBe(CLOSE3);
  });

  it('lists the available pipelines when nothing matches', () => {
    expect(() => matchPipeline([SALES, CLOSE3], 'Hiring')).toThrow(
      /Pipeline "Hiring" not found.*"Sales" \(cmoldpipe0000000000000001\).*"Close 3 paying clients by Dec 2026"/,
    );
  });

  it('refuses to guess between pipelines sharing a name', () => {
    const twin = makePipeline({ id: 'cmtwinpipe000000000000002', name: 'sales' });
    expect(() => matchPipeline([SALES, twin], 'Sales')).toThrow(/ambiguous.*Pass the id/);
  });
});

describe('matchStage', () => {
  const stages = [
    { id: 's1', projectId: 'p', name: 'Lead', color: '', order: 0, type: 'open', createdAt: new Date(), updatedAt: new Date() },
    { id: 's2', projectId: 'p', name: 'Won', color: '', order: 1, type: 'won', createdAt: new Date(), updatedAt: new Date() },
  ];

  it('matches by id or case-insensitive name', () => {
    expect(matchStage(stages, 's2', 'Sales').id).toBe('s2');
    expect(matchStage(stages, 'lead', 'Sales').id).toBe('s1');
  });

  it('names the pipeline and its stages when nothing matches', () => {
    expect(() => matchStage(stages, 'Closed', 'Sales')).toThrow(
      /Stage "Closed" not found on pipeline "Sales".*"Lead" \(s1\).*"Won" \(s2\)/,
    );
  });
});

describe('resolvePipeline', () => {
  const stdinTTY = process.stdin.isTTY;
  const stdoutTTY = process.stdout.isTTY;
  let stderr: MockInstance<typeof process.stderr.write>;

  function makeClient(pipelines: Pipeline[]) {
    const list = vi.fn().mockResolvedValue(pipelines);
    return { client: { pipelines: { list } } as never, list };
  }

  function setTTY(value: boolean) {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  }

  beforeEach(() => {
    vi.mocked(inputModule.selectOption).mockReset();
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stderr.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: stdinTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: stdoutTTY, configurable: true });
  });

  it('uses the only pipeline silently', async () => {
    setTTY(false);
    const { client } = makeClient([SALES]);

    const picked = await resolvePipeline(client, 'ws1', { useJson: true });

    expect(picked).toBe(SALES);
    expect(stderr).not.toHaveBeenCalled();
    expect(inputModule.selectOption).not.toHaveBeenCalled();
  });

  it('returns undefined when the workspace has no pipeline', async () => {
    const { client } = makeClient([]);
    expect(await resolvePipeline(client, 'ws1', { useJson: true })).toBeUndefined();
  });

  it('resolves --pipeline without prompting even on a TTY', async () => {
    setTTY(true);
    const { client } = makeClient([SALES, CLOSE3]);

    const picked = await resolvePipeline(client, 'ws1', { ref: 'close 3 paying clients by dec 2026', useJson: false });

    expect(picked).toBe(CLOSE3);
    expect(inputModule.selectOption).not.toHaveBeenCalled();
  });

  it('prompts with a select list when interactive and several exist', async () => {
    setTTY(true);
    vi.mocked(inputModule.selectOption).mockResolvedValue(CLOSE3);
    const { client } = makeClient([SALES, CLOSE3]);

    const picked = await resolvePipeline(client, 'ws1', { useJson: false });

    expect(picked).toBe(CLOSE3);
    expect(inputModule.selectOption).toHaveBeenCalledWith(
      expect.stringContaining('several pipelines'),
      [
        { label: `Sales (${SALES.id})`, value: SALES },
        { label: `Close 3 paying clients by Dec 2026 (${CLOSE3.id})`, value: CLOSE3 },
      ],
    );
    expect(stderr).not.toHaveBeenCalled();
  });

  // Scripts must keep getting the board they always got — but told about it.
  it('falls back to the default with a stderr notice when piped', async () => {
    setTTY(false);
    const { client } = makeClient([SALES, CLOSE3]);

    const picked = await resolvePipeline(client, 'ws1', { useJson: false });

    expect(picked).toBe(SALES);
    expect(inputModule.selectOption).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    const notice = String(stderr.mock.calls[0]![0]);
    expect(notice).toContain('"Sales"');
    expect(notice).toContain(SALES.id);
    expect(notice).toContain('--pipeline');
    expect(notice.endsWith('\n')).toBe(true);
  });

  it('never prompts under --json, even on a TTY', async () => {
    setTTY(true);
    const { client } = makeClient([SALES, CLOSE3]);

    const picked = await resolvePipeline(client, 'ws1', { useJson: true });

    expect(picked).toBe(SALES);
    expect(inputModule.selectOption).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
  });
});

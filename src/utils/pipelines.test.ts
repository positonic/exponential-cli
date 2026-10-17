import { describe, it, expect, vi } from 'vitest';
import type { Pipeline } from 'exponential-sdk';
import { defaultPipelineId, matchPipeline, matchStage, resolvePipeline } from './pipelines.js';

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

describe('defaultPipelineId', () => {
  it('skips retired pipelines, like the server does', () => {
    const retired = makePipeline({ id: 'cmretiredpipe00000000000x', name: 'Old', status: 'COMPLETED' });
    expect(defaultPipelineId([retired, SALES, CLOSE3])).toBe(SALES.id);
    expect(defaultPipelineId([SALES, CLOSE3])).toBe(SALES.id);
    expect(defaultPipelineId([retired])).toBeUndefined();
  });
});

describe('resolvePipeline', () => {
  function makeClient(pipelines: Pipeline[]) {
    const list = vi.fn().mockResolvedValue(pipelines);
    return { client: { pipelines: { list } } as never, list };
  }

  // Without --pipeline nothing is resolved, so no pipelineId is sent and the
  // server keeps choosing its default (oldest non-retired), as before.
  it('returns undefined without a request when --pipeline is omitted', async () => {
    const { client, list } = makeClient([SALES, CLOSE3]);
    expect(await resolvePipeline(client, 'ws1', undefined)).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  });

  it('resolves --pipeline against the workspace pipelines', async () => {
    const { client, list } = makeClient([SALES, CLOSE3]);
    expect(await resolvePipeline(client, 'ws1', 'close 3 paying clients by dec 2026')).toBe(CLOSE3);
    expect(list).toHaveBeenCalledWith('ws1');
  });

  it('rejects an unknown --pipeline', async () => {
    const { client } = makeClient([SALES]);
    await expect(resolvePipeline(client, 'ws1', 'Hiring')).rejects.toThrow(/not found/);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { runOnce, runForever } from './loop.js';
import type { Spawner, SpawnedSession } from './spawn.js';
import type { ClaimedRun } from 'exponential-sdk';

const run: ClaimedRun = {
  id: 'run-1',
  actionId: 'a1',
  predecessorId: null,
  claimedBy: 'mbp',
  startedAt: null,
  action: { id: 'a1', name: 'Find a venue', description: null, workspaceId: 'ws', project: null },
  owner: { id: 'o', name: 'James' },
  messages: [
    { role: 'system', content: '# Your Identity\nName: Aria' },
    { role: 'user', content: 'You have been assigned the action "Find a venue".' },
  ],
};

function fakeSpawner(lines: string[], exitCode = 0): { spawn: Spawner; calls: Array<Parameters<Spawner>[0]> } {
  const calls: Array<Parameters<Spawner>[0]> = [];
  const spawn: Spawner = (req) => {
    calls.push(req);
    const session: SpawnedSession = {
      lines: (async function* () { for (const l of lines) yield l; })(),
      exit: Promise.resolve(exitCode),
      kill: vi.fn(),
    };
    return session;
  };
  return { spawn, calls };
}

function fakeClient(claimed: ClaimedRun | null) {
  const agentRuns = {
    claim: vi.fn().mockResolvedValue(claimed),
    heartbeat: vi.fn().mockResolvedValue({ ok: true, lastEventAt: null }),
    appendEvents: vi.fn().mockResolvedValue({ inserted: 0, newToolCalls: 0, toolCallCount: 0 }),
    finish: vi.fn().mockResolvedValue({ finished: true, status: 'SUCCEEDED' }),
  };
  return { client: { agentRuns }, agentRuns };
}

describe('runOnce (tracer)', () => {
  it('claims, spawns claude with the persona and brief in the configured cwd, appends one batch, finishes SUCCEEDED with the result text', async () => {
    const { client, agentRuns } = fakeClient(run);
    const { spawn, calls } = fakeSpawner([
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"f":"x"}}]}}',
      '{"type":"result","subtype":"success","result":"Two venues shortlisted.","usage":{"input_tokens":3}}',
    ]);

    const outcome = await runOnce({ client, runnerId: 'mbp', cwd: '/work/offsite', spawn, flushMs: 60_000 });

    expect(agentRuns.claim).toHaveBeenCalledWith('mbp');
    expect(calls[0]).toMatchObject({
      cwd: '/work/offsite',
      systemPrompt: '# Your Identity\nName: Aria',
      prompt: 'You have been assigned the action "Find a venue".',
    });
    expect(agentRuns.appendEvents).toHaveBeenCalledTimes(1);
    expect(agentRuns.appendEvents).toHaveBeenCalledWith(
      'run-1',
      [{ seq: 1, kind: 'tool_call', payload: { tool: 'Read', input: '{"f":"x"}' } }],
      'mbp',
    );
    expect(agentRuns.finish).toHaveBeenCalledWith(
      'run-1',
      { status: 'SUCCEEDED', summary: 'Two venues shortlisted.', usage: { input_tokens: 3 } },
      'mbp',
    );
    expect(outcome).toEqual({ runId: 'run-1', status: 'SUCCEEDED', eventsSent: 1 });
  });

  it('returns null without spawning when nothing is queued', async () => {
    const { client } = fakeClient(null);
    const { spawn, calls } = fakeSpawner([]);
    expect(await runOnce({ client, runnerId: 'mbp', cwd: '/w', spawn })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a non-zero exit or an error result finishes FAILED with the error', async () => {
    const { client, agentRuns } = fakeClient(run);
    const { spawn } = fakeSpawner(['{"type":"result","subtype":"error_max_turns","is_error":true}'], 1);
    await runOnce({ client, runnerId: 'mbp', cwd: '/w', spawn });
    expect(agentRuns.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'FAILED', error: 'error_max_turns' }), 'mbp');
  });

  it('a spawn failure finishes FAILED with the message', async () => {
    const { client, agentRuns } = fakeClient(run);
    const spawn: Spawner = () => ({
      lines: (async function* () { throw new Error('could not start claude: ENOENT'); })(),
      exit: Promise.resolve(1),
      kill: vi.fn(),
    });
    await runOnce({ client, runnerId: 'mbp', cwd: '/w', spawn });
    expect(agentRuns.finish).toHaveBeenCalledWith('run-1', { status: 'FAILED', error: 'could not start claude: ENOENT' }, 'mbp');
  });
});

describe('runForever', () => {
  it('sleeps between empty polls and stops when asked', async () => {
    const { client, agentRuns } = fakeClient(null);
    const { spawn } = fakeSpawner([]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runForever({
      client, runnerId: 'mbp', cwd: '/w', spawn, intervalMs: 1000, sleep,
      shouldStop: () => agentRuns.claim.mock.calls.length >= 3,
    });
    // Three empty polls; the runner sleeps after each one it is not told to stop after.
    expect(agentRuns.claim).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});

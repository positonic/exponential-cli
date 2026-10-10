import type { AgentRunsApi, ClaimedRun, FinishInput, RunnerEvent } from 'exponential-sdk';
import { StreamParser } from './stream.js';
import type { Spawner } from './spawn.js';

/**
 * The local runner (Exponential ADR-0067, Agent PRD V2): claim a run with the
 * Assistant's agent key, spawn the owner's CLI with the persona and brief,
 * stream what it did as events, finish. The app owns run state; this process
 * only reports. Working directory and CLI choice come from local
 * configuration only — never from the server.
 */

/** The slice of the SDK client the runner uses — structural, so tests pass a plain object. */
export interface RunnerClient {
  agentRuns: Pick<AgentRunsApi, 'claim' | 'heartbeat' | 'appendEvents' | 'finish'>;
}

export interface RunnerOptions {
  client: RunnerClient;
  runnerId: string;
  cwd: string;
  spawn: Spawner;
  /** Extra args for the spawned CLI (MCP config etc.). */
  extraArgs?: string[];
  /** Heartbeat cadence while a session runs (ms). The app times out a silent run after 5 min. */
  heartbeatMs?: number;
  /** Flush events at most this often (ms) while the session runs. */
  flushMs?: number;
  log?: (line: string) => void;
}

export interface RunOutcome {
  runId: string;
  status: FinishInput['status'];
  eventsSent: number;
}

const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_FLUSH_MS = 5_000;
const MAX_BATCH = 200;

/** Build the user turn from the claimed run's messages (the app sends persona first, then the brief). */
export function promptsFor(run: ClaimedRun): { systemPrompt: string; prompt: string } {
  const system = run.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const user = run.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  return { systemPrompt: system, prompt: user || `You have been assigned the action "${run.action.name}".` };
}

/** Claim one run and work it to the end. Returns null when nothing was queued. */
export async function runOnce(options: RunnerOptions): Promise<RunOutcome | null> {
  const { client, runnerId, cwd, spawn } = options;
  const log = options.log ?? (() => undefined);
  const run = await client.agentRuns.claim(runnerId);
  if (!run) return null;
  log(`claimed run ${run.id} for action "${run.action.name}"`);

  const parser = new StreamParser(1);
  let eventsSent = 0;
  let cancelled = false;

  const flush = async () => {
    const batch = parser.drain();
    for (let i = 0; i < batch.length; i += MAX_BATCH) {
      const slice = batch.slice(i, i + MAX_BATCH);
      await client.agentRuns.appendEvents(run.id, slice, runnerId);
      eventsSent += slice.length;
    }
  };

  const { systemPrompt, prompt } = promptsFor(run);
  const session = spawn({ prompt, systemPrompt, cwd, extraArgs: options.extraArgs });

  const heartbeat = setInterval(() => {
    void client.agentRuns
      .heartbeat(run.id, runnerId)
      .then((h) => {
        if (!h.ok) {
          cancelled = true;
          log(`run ${run.id} left RUNNING (cancelled) — stopping the session`);
          session.kill();
        }
      })
      .catch((err: unknown) => log(`heartbeat failed: ${err instanceof Error ? err.message : String(err)}`));
  }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  const flusher = setInterval(() => {
    void flush().catch((err: unknown) => log(`append failed: ${err instanceof Error ? err.message : String(err)}`));
  }, options.flushMs ?? DEFAULT_FLUSH_MS);

  let exitCode = 1;
  let spawnError: string | null = null;
  try {
    for await (const line of session.lines) {
      parser.feed(line);
    }
    exitCode = await session.exit;
  } catch (err) {
    spawnError = err instanceof Error ? err.message : String(err);
  } finally {
    clearInterval(heartbeat);
    clearInterval(flusher);
  }

  await flush().catch((err: unknown) => log(`final append failed: ${err instanceof Error ? err.message : String(err)}`));

  if (cancelled) return { runId: run.id, status: 'FAILED', eventsSent };

  const snap = parser.snapshot();
  let outcome: FinishInput;
  if (spawnError) {
    outcome = { status: 'FAILED', error: spawnError };
  } else if (snap.isError || exitCode !== 0) {
    outcome = {
      status: 'FAILED',
      error: snap.errorMessage ?? `claude exited with code ${exitCode}`,
      summary: snap.resultText ?? undefined,
      usage: snap.usage ?? undefined,
    };
  } else {
    outcome = {
      status: 'SUCCEEDED',
      summary: snap.resultText ?? undefined,
      usage: snap.usage ?? undefined,
    };
  }
  await client.agentRuns.finish(run.id, outcome, runnerId);
  log(`run ${run.id} ${outcome.status.toLowerCase()} (${eventsSent} events)`);
  return { runId: run.id, status: outcome.status, eventsSent };
}

/** Poll until stopped: claim and work a run, then wait `intervalMs` when the queue is empty. */
export async function runForever(
  options: RunnerOptions & { intervalMs: number; shouldStop: () => boolean; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? (() => undefined);
  while (!options.shouldStop()) {
    let outcome: RunOutcome | null = null;
    try {
      outcome = await runOnce(options);
    } catch (err) {
      log(`runner error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!outcome && !options.shouldStop()) await sleep(options.intervalMs);
  }
}

export type { RunnerEvent };

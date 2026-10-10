import type { AgentRunsApi, ClaimedRun, FinishInput, RunnerEvent } from 'exponential-sdk';
import { StreamParser } from './stream.js';
import type { Spawner } from './spawn.js';
import { writeMcpSession, type McpSession } from './mcp.js';
import { Backoff, withRetry } from './retry.js';

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
  /** Extra args for the spawned CLI. */
  extraArgs?: string[];
  /**
   * Credentials for the per-run MCP server the session talks to its run
   * through. Omit to spawn without the run tools (tests).
   */
  mcp?: { token: string; apiUrl: string; command?: string[]; allowedTools?: string[] };
  /** Heartbeat cadence while a session runs (ms). The app times out a silent run after 5 min. */
  heartbeatMs?: number;
  /** Flush events at most this often (ms) while the session runs. */
  flushMs?: number;
  /** Attempts per app call before giving up (default 5, exponential backoff). */
  retryAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
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

  const retry = { log, sleep: options.sleep, attempts: options.retryAttempts };
  // Events not yet acknowledged by the app; appendEvents is idempotent on seq,
  // so after a lost connection the same batch is simply sent again.
  let pending: RunnerEvent[] = [];
  const flush = async () => {
    pending.push(...parser.drain());
    while (pending.length > 0) {
      const slice = pending.slice(0, MAX_BATCH);
      await withRetry(() => client.agentRuns.appendEvents(run.id, slice, runnerId), retry);
      pending = pending.slice(slice.length);
      eventsSent += slice.length;
    }
  };

  const { systemPrompt, prompt } = promptsFor(run);
  let mcp: McpSession | null = null;
  if (options.mcp) {
    mcp = writeMcpSession(
      { token: options.mcp.token, apiUrl: options.mcp.apiUrl, runId: run.id, runnerId, command: options.mcp.command },
      options.mcp.allowedTools,
    );
  }
  const session = spawn({ prompt, systemPrompt, cwd, extraArgs: [...(options.extraArgs ?? []), ...(mcp?.args ?? [])] });

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
    mcp?.cleanup();
  }

  await flush().catch((err: unknown) => log(`final append failed: ${err instanceof Error ? err.message : String(err)}`));

  if (cancelled) return { runId: run.id, status: 'FAILED', eventsSent };

  const snap = parser.snapshot();
  // The session ended the run itself through the MCP run tools: ask_owner
  // parked it (the owner's reply resumes it as a new run), finish_run closed
  // it with its own summary. A second finish would be a guarded no-op server
  // side; skipping it keeps the transcript honest.
  if (snap.askedOwner) {
    log(`run ${run.id} is waiting on the owner (${eventsSent} events)`);
    return { runId: run.id, status: 'WAITING_ON_OWNER', eventsSent };
  }
  if (snap.finishedViaTool) {
    log(`run ${run.id} finished by the session (${eventsSent} events)`);
    return { runId: run.id, status: 'SUCCEEDED', eventsSent };
  }
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
  await withRetry(() => client.agentRuns.finish(run.id, outcome, runnerId), retry);
  log(`run ${run.id} ${outcome.status.toLowerCase()} (${eventsSent} events)`);
  return { runId: run.id, status: outcome.status, eventsSent };
}

/** Poll until stopped: claim and work a run, then wait `intervalMs` when the queue is empty. */
export async function runForever(
  options: RunnerOptions & { intervalMs: number; shouldStop: () => boolean },
): Promise<void> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? (() => undefined);
  // While the app is unreachable the poll interval doubles (capped at five
  // minutes) and snaps back on the first successful poll — reconnect without
  // hammering, without giving up.
  const backoff = new Backoff(options.intervalMs);
  while (!options.shouldStop()) {
    let outcome: RunOutcome | null = null;
    let failed = false;
    try {
      outcome = await runOnce(options);
      backoff.success();
    } catch (err) {
      failed = true;
      backoff.failure();
      log(`runner error: ${err instanceof Error ? err.message : String(err)} — next poll in ${Math.round(backoff.delayMs / 1000)}s`);
    }
    if ((!outcome || failed) && !options.shouldStop()) await sleep(backoff.delayMs);
  }
}

export type { RunnerEvent };

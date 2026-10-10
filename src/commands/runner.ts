import { Command } from 'commander';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { runForever, runOnce } from '../runner/loop.js';
import { spawnClaude } from '../runner/spawn.js';

/**
 * `exponential runner start` — the local executor for an Assistant whose
 * executor is "My machine" (Exponential ADR-0067, Agent PRD V2). Log in with
 * the Assistant's runner key first (`exponential auth login --token exp_agent_...`);
 * the runner claims queued runs with it, spawns `claude -p` with your own
 * login in the directory you choose, and reports progress back.
 */
export function createRunnerCommand(): Command {
  const cmd = new Command('runner').description(
    'Run your Assistant locally: claim its queued runs and work them with Claude Code on this machine',
  );

  cmd
    .command('start')
    .description('Poll for queued runs and work them until stopped (Ctrl-C)')
    .option('--runner-id <id>', 'Name of this runner, recorded on each run', hostname())
    .option('--cwd <dir>', 'Working directory for the spawned CLI (local config only, never from the server)', process.cwd())
    .option('--interval <seconds>', 'Seconds between polls when nothing is queued', '15')
    .option('--once', 'Claim at most one run, work it, and exit')
    .action(async (opts: { runnerId: string; cwd: string; interval: string; once?: boolean }) => {
      try {
        const client = getClient();
        const cwd = resolve(opts.cwd);
        const log = (line: string) => console.error(`[runner ${opts.runnerId}] ${line}`);
        const base = { client, runnerId: opts.runnerId, cwd, spawn: spawnClaude, log };
        if (opts.once) {
          const outcome = await runOnce(base);
          console.log(JSON.stringify(outcome ?? { runId: null, status: 'IDLE', eventsSent: 0 }));
          return;
        }
        let stop = false;
        const onSignal = () => {
          stop = true;
          log('stopping after the current run');
        };
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);
        log(`polling every ${opts.interval}s in ${cwd}`);
        await runForever({ ...base, intervalMs: Number(opts.interval) * 1000, shouldStop: () => stop });
      } catch (error) {
        handleError(error);
      }
    });

  return cmd;
}

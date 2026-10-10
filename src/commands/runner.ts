import { Command } from 'commander';
import { hostname, homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getClient } from '../client/index.js';
import { getConfig } from '../config/index.js';
import { loadRunnerConfig, runnerConfigPath, saveRunnerConfig } from '../runner/config.js';
import { handleError } from '../utils/errors.js';
import { runForever, runOnce } from '../runner/loop.js';
import { spawnClaude } from '../runner/spawn.js';
import { planService, removeServiceFile, writeServiceFile } from '../runner/install.js';

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
    .option('--cwd <dir>', 'Working directory for the spawned CLI (overrides runner config; never from the server)')
    .option('--interval <seconds>', 'Seconds between polls when nothing is queued', '15')
    .option('--once', 'Claim at most one run, work it, and exit')
    .option('--no-mcp', 'Spawn without the Exponential MCP run tools (progress still streams; the session cannot ask the owner)')
    .action(async (opts: { runnerId: string; cwd?: string; interval: string; once?: boolean; mcp: boolean }) => {
      try {
        const client = getClient();
        const settings = loadRunnerConfig();
        const cwd = resolve(opts.cwd ?? settings.cwd ?? process.cwd());
        const auth = getConfig();
        const log = (line: string) => console.error(`[runner ${opts.runnerId}] ${line}`);
        const base = {
          client,
          runnerId: opts.runnerId,
          cwd,
          spawn: spawnClaude,
          log,
          mcp: opts.mcp
            ? { token: auth.token, apiUrl: auth.apiUrl, command: settings.mcpCommand, allowedTools: settings.allowedTools }
            : undefined,
        };
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

  cmd
    .command('install')
    .description('Keep the runner running as a user service (launchd on macOS, systemd --user on Linux)')
    .option('--runner-id <id>', 'Name of this runner', hostname())
    .option('--cwd <dir>', 'Working directory for the spawned CLI (defaults to runner config, then the current directory)')
    .option('--dry-run', 'Print the service file and commands without installing')
    .action((opts: { runnerId: string; cwd?: string; dryRun?: boolean }) => {
      try {
        getClient(); // fail early when not logged in with the runner key
        const settings = loadRunnerConfig();
        const cwd = resolve(opts.cwd ?? settings.cwd ?? process.cwd());
        const logDir = resolve(homedir(), 'Library', 'Logs', 'exponential-runner');
        const plan = planService({
          exponentialBin: resolve(fileURLToPath(import.meta.url), '..', '..', 'bin', 'exponential.js'),
          nodeBin: process.execPath,
          runnerId: opts.runnerId,
          cwd,
          logDir: process.platform === 'darwin' ? logDir : resolve(tmpdir(), 'exponential-runner'),
          path: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          home: homedir(),
        });
        if (opts.dryRun) {
          console.log(`# ${plan.file}
${plan.contents}
# load: ${plan.load.join(' ')}
# unload: ${plan.unload.join(' ')}`);
          return;
        }
        if (plan.kind === 'launchd') mkdirSync(logDir, { recursive: true });
        saveRunnerConfig({ cwd });
        writeServiceFile(plan);
        try {
          execFileSync(plan.unload[0]!, plan.unload.slice(1), { stdio: 'ignore' });
        } catch {
          // not loaded yet
        }
        execFileSync(plan.load[0]!, plan.load.slice(1), { stdio: 'inherit' });
        console.error(`Installed ${plan.kind} service ${plan.file}; the runner works in ${cwd}.`);
      } catch (error) {
        handleError(error);
      }
    });

  cmd
    .command('uninstall')
    .description('Stop and remove the runner user service')
    .action(() => {
      try {
        const plan = planService({
          exponentialBin: '', nodeBin: '', runnerId: '', cwd: '', logDir: '', path: '', home: homedir(),
        });
        try {
          execFileSync(plan.unload[0]!, plan.unload.slice(1), { stdio: 'ignore' });
        } catch {
          // not loaded
        }
        console.error(removeServiceFile(plan) ? `Removed ${plan.file}` : `No service file at ${plan.file}`);
      } catch (error) {
        handleError(error);
      }
    });

  const config = cmd.command('config').description(`Runner settings on this machine (${runnerConfigPath()})`);
  config
    .command('show')
    .description('Print the runner settings')
    .action(() => {
      console.log(JSON.stringify({ path: runnerConfigPath(), ...loadRunnerConfig() }, null, 2));
    });
  config
    .command('set')
    .description('Set a runner setting: cwd <dir> | allowed-tools <a,b,c> | mcp-command <cmd ...>')
    .argument('<key>', 'cwd | allowed-tools | mcp-command')
    .argument('<value...>', 'The value')
    .action((key: string, value: string[]) => {
      try {
        let next;
        if (key === 'cwd') next = saveRunnerConfig({ cwd: resolve(value.join(' ')) });
        else if (key === 'allowed-tools') next = saveRunnerConfig({ allowedTools: value.join(' ').split(',').map((t) => t.trim()).filter(Boolean) });
        else if (key === 'mcp-command') next = saveRunnerConfig({ mcpCommand: value });
        else throw new Error(`Unknown setting "${key}". Use cwd, allowed-tools or mcp-command.`);
        console.log(JSON.stringify(next, null, 2));
      } catch (error) {
        handleError(error);
      }
    });

  return cmd;
}

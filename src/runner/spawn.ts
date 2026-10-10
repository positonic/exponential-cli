import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * How the runner starts a CLI session for one run. Injected so the loop can be
 * tested with a fake; the real one below spawns Claude Code with the owner's
 * own login (it inherits the environment — no credential is passed in).
 */
export interface SpawnedSession {
  /** Stream-json lines as they arrive. */
  lines: AsyncIterable<string>;
  /** Resolves with the exit code once the process ends. */
  exit: Promise<number>;
  /** Stop the session (on cancel or shutdown). */
  kill: () => void;
}

export interface SpawnRequest {
  /** The user turn: the action brief. */
  prompt: string;
  /** Appended to the CLI's system prompt: the Assistant's persona. */
  systemPrompt: string;
  /** Working directory — from local configuration only, never from the server. */
  cwd: string;
  /** Extra CLI arguments (e.g. `--mcp-config <file>`). */
  extraArgs?: string[];
}

export type Spawner = (request: SpawnRequest) => SpawnedSession;

/** `claude -p <brief> --output-format stream-json --verbose --append-system-prompt <persona>`. */
export const spawnClaude: Spawner = ({ prompt, systemPrompt, cwd, extraArgs = [] }) => {
  const child = spawn(
    'claude',
    ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--append-system-prompt', systemPrompt, ...extraArgs],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );
  const stderr: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  const exit = new Promise<number>((resolve, reject) => {
    child.on('error', (err) => reject(new Error(`could not start claude: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0 && stderr.length) {
        process.stderr.write(stderr.join('').slice(-2000));
      }
      resolve(code ?? 1);
    });
  });
  return { lines, exit, kill: () => child.kill('SIGTERM') };
};

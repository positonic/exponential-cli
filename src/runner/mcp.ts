import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The spawned session talks to its run through the Exponential MCP server
 * (`report_progress`, `ask_owner`, `finish_run` — exponential-mcp ≥ 0.8).
 * The runner writes a per-run MCP config file naming that server with the
 * Assistant's agent key and the run id in its environment, and passes it to
 * the CLI with `--mcp-config`. The file is deleted when the run ends; the key
 * never appears on the command line.
 */

export const MCP_SERVER_NAME = 'exponential';
export const RUN_TOOL_NAMES = ['report_progress', 'ask_owner', 'finish_run'] as const;

export interface McpSessionInput {
  token: string;
  apiUrl: string;
  runId: string;
  runnerId: string;
  /** Default `npx -y exponential-mcp`. */
  command?: string[];
}

export function buildMcpConfig(input: McpSessionInput): Record<string, unknown> {
  const [command, ...args] = input.command ?? ['npx', '-y', 'exponential-mcp'];
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command,
        args,
        env: {
          EXPONENTIAL_API_KEY: input.token,
          EXPONENTIAL_API_URL: input.apiUrl,
          EXPONENTIAL_RUN_ID: input.runId,
          EXPONENTIAL_RUNNER_ID: input.runnerId,
        },
      },
    },
  };
}

/** Fully-qualified tool names the session may call without a permission prompt. */
export function allowedRunTools(extra: string[] = []): string[] {
  return [...RUN_TOOL_NAMES.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`), ...extra];
}

export interface McpSession {
  /** Arguments to append to the CLI invocation. */
  args: string[];
  /** Remove the config file. */
  cleanup: () => void;
}

export function writeMcpSession(input: McpSessionInput, extraAllowed: string[] = []): McpSession {
  const dir = mkdtempSync(join(tmpdir(), 'exponential-runner-'));
  const file = join(dir, 'mcp.json');
  writeFileSync(file, JSON.stringify(buildMcpConfig(input), null, 2), { mode: 0o600 });
  return {
    args: ['--mcp-config', file, '--allowedTools', allowedRunTools(extraAllowed).join(',')],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

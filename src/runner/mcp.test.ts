import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { allowedRunTools, buildMcpConfig, writeMcpSession } from './mcp.js';

describe('MCP session for a run', () => {
  it('names the Exponential server with the key, api url, run and runner in its env — never on the command line', () => {
    const config = buildMcpConfig({ token: 'exp_agent_abc', apiUrl: 'http://localhost:3000', runId: 'run-1', runnerId: 'mbp' });
    expect(config).toEqual({
      mcpServers: {
        exponential: {
          command: 'npx',
          args: ['-y', 'exponential-mcp'],
          env: {
            EXPONENTIAL_API_KEY: 'exp_agent_abc',
            EXPONENTIAL_API_URL: 'http://localhost:3000',
            EXPONENTIAL_RUN_ID: 'run-1',
            EXPONENTIAL_RUNNER_ID: 'mbp',
          },
        },
      },
    });
  });

  it('allows exactly the run tools plus whatever the local config adds', () => {
    expect(allowedRunTools()).toEqual([
      'mcp__exponential__report_progress',
      'mcp__exponential__ask_owner',
      'mcp__exponential__finish_run',
    ]);
    expect(allowedRunTools(['Read', 'Bash(git:*)'])).toContain('Bash(git:*)');
  });

  it('writes a private temp file, passes it with --mcp-config, and removes it on cleanup', () => {
    const session = writeMcpSession({ token: 't', apiUrl: 'u', runId: 'r', runnerId: 'x' }, ['Read']);
    const file = session.args[session.args.indexOf('--mcp-config') + 1]!;
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf-8')).mcpServers.exponential.env.EXPONENTIAL_RUN_ID).toBe('r');
    expect(session.args.join(' ')).not.toContain('exp_agent');
    expect(session.args[session.args.indexOf('--allowedTools') + 1]).toBe(
      'mcp__exponential__report_progress,mcp__exponential__ask_owner,mcp__exponential__finish_run,Read',
    );
    session.cleanup();
    expect(existsSync(file)).toBe(false);
  });
});

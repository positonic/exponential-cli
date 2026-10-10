import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigPath } from '../config/index.js';

/**
 * Runner settings live next to the CLI's own config file, on this machine
 * only (Exponential ADR-0067: the working directory and the CLI the runner
 * spawns are local decisions — the server never names them).
 */
export interface RunnerConfig {
  /** Directory the spawned CLI works in. Defaults to the directory `runner start` is run from. */
  cwd?: string;
  /** Which CLI to spawn. Only `claude` is implemented today. */
  cli?: 'claude';
  /** Extra tool names the spawned session may use without asking (added to the run tools). */
  allowedTools?: string[];
  /** Command that starts the Exponential MCP server for the session (default: `npx -y exponential-mcp`). */
  mcpCommand?: string[];
}

export function runnerConfigPath(): string {
  return join(dirname(getConfigPath()), 'runner.json');
}

export function loadRunnerConfig(path = runnerConfigPath()): RunnerConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RunnerConfig;
  } catch {
    throw new Error(`Could not parse ${path}; fix or delete it`);
  }
}

export function saveRunnerConfig(values: Partial<RunnerConfig>, path = runnerConfigPath()): RunnerConfig {
  const next = { ...loadRunnerConfig(path), ...values };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
  return next;
}

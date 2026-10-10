import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * `exponential runner install` keeps the runner alive as a user service, so
 * the Assistant's runs are picked up whenever the machine is awake: a launchd
 * agent on macOS, a systemd user unit on Linux. Both call the same
 * `exponential runner start` the user can run by hand; nothing else changes.
 */

export const SERVICE_LABEL = 'im.exponential.runner';

export interface InstallInput {
  /** Absolute path to the `exponential` executable. */
  exponentialBin: string;
  /** Absolute path to node (launchd gets no shell PATH). */
  nodeBin: string;
  runnerId: string;
  /** Working directory for the spawned CLI, resolved; passed as --cwd. */
  cwd: string;
  /** Directory for log files. */
  logDir: string;
  /** PATH the service runs with (so `claude` and `npx` resolve). */
  path: string;
  home: string;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function launchdPlist(input: InstallInput): string {
  const args = [input.nodeBin, input.exponentialBin, 'runner', 'start', '--runner-id', input.runnerId, '--cwd', input.cwd];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(input.path)}</string>
    <key>HOME</key><string>${xmlEscape(input.home)}</string>
  </dict>
  <key>WorkingDirectory</key><string>${xmlEscape(input.cwd)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(join(input.logDir, 'runner.log'))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(input.logDir, 'runner.log'))}</string>
</dict>
</plist>
`;
}

export function systemdUnit(input: InstallInput): string {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  return `[Unit]
Description=Exponential Assistant runner
After=network-online.target

[Service]
ExecStart=${q(input.nodeBin)} ${q(input.exponentialBin)} runner start --runner-id ${q(input.runnerId)} --cwd ${q(input.cwd)}
WorkingDirectory=${input.cwd}
Environment=PATH=${input.path}
Environment=HOME=${input.home}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

export interface ServicePlan {
  kind: 'launchd' | 'systemd';
  file: string;
  contents: string;
  /** Commands the user (or `install`) runs to start / stop it. */
  load: string[];
  unload: string[];
}

export function planService(input: InstallInput, os: NodeJS.Platform = platform(), home = homedir()): ServicePlan {
  if (os === 'darwin') {
    const file = join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    return {
      kind: 'launchd',
      file,
      contents: launchdPlist(input),
      load: ['launchctl', 'bootstrap', `gui/${process.getuid?.() ?? 501}`, file],
      unload: ['launchctl', 'bootout', `gui/${process.getuid?.() ?? 501}/${SERVICE_LABEL}`],
    };
  }
  if (os === 'linux') {
    const file = join(home, '.config', 'systemd', 'user', 'exponential-runner.service');
    return {
      kind: 'systemd',
      file,
      contents: systemdUnit(input),
      load: ['systemctl', '--user', 'enable', '--now', 'exponential-runner.service'],
      unload: ['systemctl', '--user', 'disable', '--now', 'exponential-runner.service'],
    };
  }
  throw new Error(`runner install is not supported on ${os}; run "exponential runner start" in a terminal instead`);
}

export function writeServiceFile(plan: ServicePlan): void {
  mkdirSync(join(plan.file, '..'), { recursive: true });
  writeFileSync(plan.file, plan.contents, { mode: 0o644 });
}

export function removeServiceFile(plan: ServicePlan): boolean {
  if (!existsSync(plan.file)) return false;
  rmSync(plan.file);
  return true;
}

import { describe, it, expect } from 'vitest';
import { launchdPlist, planService, systemdUnit, SERVICE_LABEL } from './install.js';

const input = {
  exponentialBin: '/opt/cli/bin/exponential.js',
  nodeBin: '/usr/local/bin/node',
  runnerId: 'james-mbp',
  cwd: '/Users/james/work & play',
  logDir: '/Users/james/Library/Logs/exponential-runner',
  path: '/usr/local/bin:/usr/bin:/bin',
  home: '/Users/james',
};

describe('runner install plans', () => {
  it('launchd: a KeepAlive user agent running `runner start` with the configured cwd, XML-escaped', () => {
    const plan = planService(input, 'darwin', '/Users/james');
    expect(plan.kind).toBe('launchd');
    expect(plan.file).toBe(`/Users/james/Library/LaunchAgents/${SERVICE_LABEL}.plist`);
    expect(plan.contents).toBe(launchdPlist(input));
    expect(plan.contents).toContain('<string>runner</string>\n    <string>start</string>');
    expect(plan.contents).toContain('<string>/Users/james/work &amp; play</string>');
    expect(plan.contents).toContain('<key>KeepAlive</key><true/>');
    expect(plan.load.join(' ')).toMatch(/^launchctl bootstrap gui\/\d+ /);
  });

  it('systemd: a user unit with Restart=always', () => {
    const plan = planService(input, 'linux', '/home/james');
    expect(plan.kind).toBe('systemd');
    expect(plan.file).toBe('/home/james/.config/systemd/user/exponential-runner.service');
    expect(plan.contents).toBe(systemdUnit(input));
    expect(plan.contents).toContain('Restart=always');
    expect(plan.contents).toContain('runner start --runner-id "james-mbp" --cwd "/Users/james/work & play"');
    expect(plan.load).toEqual(['systemctl', '--user', 'enable', '--now', 'exponential-runner.service']);
  });

  it('refuses other platforms with a hint', () => {
    expect(() => planService(input, 'win32', 'C:\\\\Users\\\\james')).toThrow(/runner start/);
  });
});

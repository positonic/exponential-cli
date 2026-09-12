import { Command } from 'commander';
import { createAuthCommand } from './commands/auth.js';
import { createActionsCommand } from './commands/actions.js';
import { createContactsCommand } from './commands/contacts.js';
import { createDecisionsCommand } from './commands/decisions.js';
import { createDealsCommand } from './commands/deals.js';
import { createEpicsCommand } from './commands/epics.js';
import { createFeaturesCommand } from './commands/features.js';
import { createLabelsCommand } from './commands/labels.js';
import { createMeetingsCommand } from './commands/meetings.js';
import { createOrganizationsCommand } from './commands/organizations.js';
import { createPagesCommand } from './commands/pages.js';
import { createProductsCommand } from './commands/products.js';
import { createProjectsCommand } from './commands/projects.js';
import { createSearchCommand } from './commands/search.js';
import { createTicketsCommand } from './commands/tickets.js';
import { createTimeCommand } from './commands/time.js';
import { createWorkspacesCommand } from './commands/workspaces.js';
import { createGoalsCommand, createOkrsCommand } from './commands/goals.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read the real version rather than a hand-maintained literal, which drifted
// far enough that `--version` reported 1.0.0 while 1.9.0 was on npm.
export const PKG_VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
).version;

// The root program's version flag is spelled `--cli-version`, NOT `--version`.
// Commander parses root options anywhere in argv (unless positional options are
// enabled, which would break `actions list --json`), so a root `--version`
// swallowed `features scopes add --version V1` and printed the CLI version
// instead of creating a scope. `-V` is kept; bare `exponential --version` is
// handled by isBareVersionRequest() before parsing.
export const CLI_VERSION_FLAGS = '-V, --cli-version';

/**
 * True when the user asked for the CLI version with the pre-1.15.1 spelling:
 * `--version` is present and no subcommand is named (every arg is a flag).
 * `features scopes add --version V1` names a subcommand, so it is never bare.
 */
export function isBareVersionRequest(args: string[]): boolean {
  return args.includes('--version') && args.every((arg) => arg.startsWith('-'));
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('exponential')
    .description(
      [
        'CLI to interact with Exponential productivity app.',
        '',
        'Work-tracking hierarchy:',
        '  workspace -> product -> feature -> ticket -> action',
        '  epics are workspace-scoped and can group tickets and actions across products.',
      ].join('\n'),
    )
    .version(PKG_VERSION, CLI_VERSION_FLAGS, 'Output the CLI version')
    .option('--json', 'Output as JSON (default when piped)')
    .option('--pretty', 'Force pretty-printed output');

  // Add subcommands
  program.addCommand(createAuthCommand());
  program.addCommand(createActionsCommand());
  program.addCommand(createContactsCommand());
  program.addCommand(createDecisionsCommand());
  program.addCommand(createDealsCommand());
  program.addCommand(createEpicsCommand());
  program.addCommand(createFeaturesCommand());
  program.addCommand(createLabelsCommand());
  program.addCommand(createMeetingsCommand());
  program.addCommand(createOrganizationsCommand());
  program.addCommand(createPagesCommand());
  program.addCommand(createProductsCommand());
  program.addCommand(createProjectsCommand());
  program.addCommand(createSearchCommand());
  program.addCommand(createTicketsCommand());
  program.addCommand(createTimeCommand());
  program.addCommand(createWorkspacesCommand());
  program.addCommand(createGoalsCommand());
  program.addCommand(createOkrsCommand());

  return program;
}

#!/usr/bin/env node
import { Command } from 'commander';
import { createAuthCommand } from './commands/auth.js';
import { createActionsCommand } from './commands/actions.js';
import { createContactsCommand } from './commands/contacts.js';
import { createDealsCommand } from './commands/deals.js';
import { createEpicsCommand } from './commands/epics.js';
import { createFeaturesCommand } from './commands/features.js';
import { createLabelsCommand } from './commands/labels.js';
import { createOrganizationsCommand } from './commands/organizations.js';
import { createPagesCommand } from './commands/pages.js';
import { createProductsCommand } from './commands/products.js';
import { createProjectsCommand } from './commands/projects.js';
import { createSearchCommand } from './commands/search.js';
import { createTicketsCommand } from './commands/tickets.js';
import { createWorkspacesCommand } from './commands/workspaces.js';

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
  .version('1.0.0')
  .option('--json', 'Output as JSON (default when piped)')
  .option('--pretty', 'Force pretty-printed output');

// Add subcommands
program.addCommand(createAuthCommand());
program.addCommand(createActionsCommand());
program.addCommand(createContactsCommand());
program.addCommand(createDealsCommand());
program.addCommand(createEpicsCommand());
program.addCommand(createFeaturesCommand());
program.addCommand(createLabelsCommand());
program.addCommand(createOrganizationsCommand());
program.addCommand(createPagesCommand());
program.addCommand(createProductsCommand());
program.addCommand(createProjectsCommand());
program.addCommand(createSearchCommand());
program.addCommand(createTicketsCommand());
program.addCommand(createWorkspacesCommand());

program.parse();

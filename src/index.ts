#!/usr/bin/env node
import { Command } from 'commander';
import { createAuthCommand } from './commands/auth.js';
import { createActionsCommand } from './commands/actions.js';
import { createProjectsCommand } from './commands/projects.js';
import { createWorkspacesCommand } from './commands/workspaces.js';

const program = new Command();

program
  .name('exponential')
  .description('CLI to interact with Exponential productivity app')
  .version('1.0.0')
  .option('--json', 'Output as JSON (default when piped)')
  .option('--pretty', 'Force pretty-printed output');

// Add subcommands
program.addCommand(createAuthCommand());
program.addCommand(createActionsCommand());
program.addCommand(createProjectsCommand());
program.addCommand(createWorkspacesCommand());

program.parse();

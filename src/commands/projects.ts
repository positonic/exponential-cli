import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputProjectsJson,
  outputProjectsPretty,
} from '../utils/output.js';
import type { Project } from 'exponential-sdk';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
  workspace?: string;
}

export function createProjectsCommand(): Command {
  const projects = new Command('projects')
    .description('Manage projects');

  projects
    .command('list')
    .description('List all projects')
    .option('--workspace <id>', 'Filter by workspace ID')
    .option('--include-actions', 'Include actions in output')
    .action(async (options: { workspace?: string; includeActions?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const projects = await client.projects.list({
          workspaceId: options.workspace,
          includeActions: options.includeActions,
        });

        if (useJson) {
          outputProjectsJson(projects);
        } else {
          outputProjectsPretty(projects);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return projects;
}

import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../client/index.js';
import { getConfig, setConfig } from '../config/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputWorkspacesJson,
  outputWorkspacesPretty,
} from '../utils/output.js';
import type { Workspace } from 'exponential-sdk';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

export function createWorkspacesCommand(): Command {
  const workspaces = new Command('workspaces')
    .description('Manage workspaces');

  workspaces
    .command('list')
    .description('List all workspaces')
    .action(async (_options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const workspaces = await client.workspaces.list();

        if (useJson) {
          outputWorkspacesJson(workspaces);
        } else {
          const config = getConfig();
          outputWorkspacesPretty(workspaces);

          if (config.defaultWorkspaceSlug) {
            console.log(chalk.gray(`Default workspace: ${config.defaultWorkspaceSlug}`));
          }
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  workspaces
    .command('set-default <slug>')
    .description('Set the default workspace')
    .action(async (slug: string) => {
      try {
        const client = getClient();
        const workspaces = await client.workspaces.list();

        const workspace = workspaces.find((w: Workspace) => w.slug === slug);

        if (!workspace) {
          console.error(chalk.red(`Workspace with slug "${slug}" not found.`));
          console.log(chalk.gray('Available workspaces:'));
          workspaces.forEach((w: Workspace) => {
            console.log(chalk.gray(`  - ${w.slug} (${w.name})`));
          });
          process.exit(1);
        }

        setConfig({
          defaultWorkspaceId: workspace.id,
          defaultWorkspaceSlug: workspace.slug,
        });

        console.log(chalk.green(`Default workspace set to: ${workspace.name} (${workspace.slug})`));
      } catch (error) {
        handleError(error);
      }
    });

  return workspaces;
}

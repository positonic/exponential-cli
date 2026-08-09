import { Command } from 'commander';
import type { ProjectPriority, ProjectStatus } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputProjectJson,
  outputProjectPretty,
  outputProjectsJson,
  outputProjectsPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
  workspace?: string;
}

const PROJECT_STATUSES: ProjectStatus[] = [
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
];

const PROJECT_PRIORITIES: ProjectPriority[] = ['HIGH', 'MEDIUM', 'LOW', 'NONE'];

function validateProjectStatus(
  value: string | undefined,
): ProjectStatus | undefined {
  if (!value) return undefined;
  if (!(PROJECT_STATUSES as string[]).includes(value)) {
    throw new Error(
      `Invalid project status "${value}". Valid: ${PROJECT_STATUSES.join(', ')}`,
    );
  }
  return value as ProjectStatus;
}

function validateProjectPriority(
  value: string | undefined,
): ProjectPriority | undefined {
  if (!value) return undefined;
  if (!(PROJECT_PRIORITIES as string[]).includes(value)) {
    throw new Error(
      `Invalid project priority "${value}". Valid: ${PROJECT_PRIORITIES.join(', ')}`,
    );
  }
  return value as ProjectPriority;
}

export function createProjectsCommand(): Command {
  const projects = new Command('projects')
    .description('Manage projects');

  projects
    .command('list')
    .description('List all projects')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .option('--include-actions', 'Include actions in output')
    .action(async (options: { workspace?: string; includeActions?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        // Takes a slug like every other `--workspace` in the CLI; a raw CUID
        // still resolves to itself. Omitted means "every workspace you can see",
        // which is what the server does with no filter — so no default is
        // applied here.
        const workspaceId = options.workspace
          ? await resolveWorkspaceId(client, options.workspace)
          : undefined;
        const projects = await client.projects.list({
          workspaceId,
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

  projects
    .command('get <id>')
    .description(
      'Get one project with its objectives, key results, DRI and actions — none ' +
        'of which `projects list` carries. Accepts a CUID, a slug, or the ' +
        'slug-cuid form from app URLs.',
    )
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const project = await client.projects.get(id);
        if (useJson) outputProjectJson(project);
        else outputProjectPretty(project);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  projects
    .command('update')
    .description(
      'Update a project. Only the fields you pass are written; the rest are read ' +
        'back from the project and re-sent unchanged.',
    )
    .requiredOption('--id <cuid>', 'Project CUID')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <text>', 'New description')
    .option('--status <status>', `Status: ${PROJECT_STATUSES.join(', ')}`)
    .option('--priority <priority>', `Priority: ${PROJECT_PRIORITIES.join(', ')}`)
    .option('--product <cuid|none>', 'Product to file the project under ("none" to unlink)')
    .option('--dri <userId|none>', 'Directly responsible individual ("none" to clear)')
    .action(
      async (
        options: {
          id: string;
          name?: string;
          description?: string;
          status?: string;
          priority?: string;
          product?: string;
          dri?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateProjectStatus(options.status);
          const priority = validateProjectPriority(options.priority);
          const client = getClient();
          const updated = await client.projects.update({
            id: options.id,
            name: options.name,
            description: options.description,
            status,
            priority,
            productId:
              options.product === undefined
                ? undefined
                : options.product === 'none'
                  ? null
                  : options.product,
            driId:
              options.dri === undefined
                ? undefined
                : options.dri === 'none'
                  ? null
                  : options.dri,
          });
          if (useJson) outputProjectJson(updated);
          else {
            console.log('\n✓ Project updated');
            outputProjectPretty(updated);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  projects
    .command('delete')
    .description(
      'Delete a project. Refuses while it still has actions or is linked to an ' +
        'objective or key result, unless --force.',
    )
    .requiredOption('--id <cuid>', 'Project CUID')
    .option('--force', 'Delete anyway, taking the actions and links with it')
    .action(async (options: { id: string; force?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const project = await client.projects.get(options.id);
        const actions = project.actions ?? [];
        const goals = project.goals ?? [];
        const keyResults = project.keyResults ?? [];

        const blockers = [
          actions.length ? `${actions.length} action(s)` : null,
          goals.length ? `${goals.length} objective link(s)` : null,
          keyResults.length ? `${keyResults.length} key result link(s)` : null,
        ].filter(Boolean) as string[];

        if (blockers.length > 0 && !options.force) {
          const payload = {
            deleted: false,
            id: project.id,
            reason: `has ${blockers.join(', ')}`,
            actionCount: actions.length,
            goals: goals.map((g) => ({ id: g.id, title: g.title })),
            keyResults: keyResults.map((k) => ({ id: k.keyResultId })),
          };
          if (useJson) console.log(JSON.stringify(payload, null, 2));
          else {
            console.error(
              `Project "${project.name}" has ${blockers.join(', ')}.\n` +
                'Re-run with --force to delete it anyway.',
            );
          }
          process.exitCode = 1;
          return;
        }

        await client.projects.delete(project.id);
        const payload = {
          deleted: true,
          id: project.id,
          actionsDeleted: actions.length,
        };
        if (useJson) console.log(JSON.stringify(payload, null, 2));
        else {
          console.log('✓ Project deleted');
          if (actions.length) {
            console.log(`  ${actions.length} action(s) went with it`);
          }
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return projects;
}

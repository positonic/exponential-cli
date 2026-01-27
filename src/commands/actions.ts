import { Command } from 'commander';
import { getClient } from '../client/trpc.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputActionsJson,
  outputActionsPretty,
} from '../utils/output.js';
import type { Action } from '../types/action.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
  workspace?: string;
}

export function createActionsCommand(): Command {
  const actions = new Command('actions')
    .description('Manage actions/tasks');

  actions
    .command('list')
    .description('List all actions')
    .option('--project <id>', 'Filter by project ID')
    .option('--status <status>', 'Filter by kanban status (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE)')
    .option('--assignee <id>', 'Filter by assignee ID')
    .action(async (options: { project?: string; status?: string; assignee?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        let actions: Action[];

        if (options.project) {
          // Use getProjectActions for project-specific queries
          actions = await client.action.getProjectActions.query({
            projectId: options.project,
            assigneeId: options.assignee,
          }) as Action[];
        } else if (options.status) {
          // Use getKanbanActions for status filtering
          const kanbanStatus = options.status as 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'CANCELLED';
          actions = await client.action.getKanbanActions.query({
            kanbanStatus,
            assigneeId: options.assignee,
          }) as Action[];
        } else {
          // Use getAll for general listing
          actions = await client.action.getAll.query({
            assigneeId: options.assignee,
          }) as Action[];
        }

        // Filter out completed/cancelled if no status specified
        if (!options.status) {
          actions = actions.filter(a =>
            a.status !== 'COMPLETED' &&
            a.status !== 'CANCELLED' &&
            a.kanbanStatus !== 'DONE' &&
            a.kanbanStatus !== 'CANCELLED'
          );
        }

        if (useJson) {
          outputActionsJson(actions, {
            projectId: options.project,
            kanbanStatus: options.status,
          });
        } else {
          outputActionsPretty(actions);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  actions
    .command('today')
    .description('Get actions due today')
    .option('--workspace <id>', 'Filter by workspace ID')
    .action(async (options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const actions = await client.action.getToday.query({
          workspaceId: options.workspace,
        }) as Action[];

        if (useJson) {
          outputActionsJson(actions, { workspaceId: options.workspace });
        } else {
          outputActionsPretty(actions);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  actions
    .command('range')
    .description('Get actions by date range')
    .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
    .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
    .option('--workspace <id>', 'Filter by workspace ID')
    .action(async (options: { start: string; end: string; workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const startDate = new Date(options.start);
        const endDate = new Date(options.end);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }

        const client = getClient();
        const actions = await client.action.getByDateRange.query({
          startDate,
          endDate,
          workspaceId: options.workspace,
        }) as Action[];

        if (useJson) {
          outputActionsJson(actions, { workspaceId: options.workspace });
        } else {
          outputActionsPretty(actions);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  actions
    .command('kanban')
    .description('Get kanban board actions')
    .option('--project <id>', 'Filter by project ID')
    .option('--status <status>', 'Filter by kanban status')
    .option('--assignee <id>', 'Filter by assignee ID')
    .action(async (options: { project?: string; status?: string; assignee?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const kanbanStatus = options.status as 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'CANCELLED' | undefined;

        const actions = await client.action.getKanbanActions.query({
          projectId: options.project,
          kanbanStatus,
          assigneeId: options.assignee,
        }) as Action[];

        if (useJson) {
          outputActionsJson(actions, {
            projectId: options.project,
            kanbanStatus: options.status,
          });
        } else {
          outputActionsPretty(actions);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return actions;
}

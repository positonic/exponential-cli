import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputActionsJson,
  outputActionsPretty,
} from '../utils/output.js';
import type { Action, KanbanStatus } from 'exponential-sdk';

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
        const kanbanStatus = options.status as KanbanStatus | undefined;

        const actions = await client.actions.list({
          projectId: options.project,
          status: kanbanStatus,
          assigneeId: options.assignee,
        });

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
        const actions = await client.actions.getToday(options.workspace);

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
        const actions = await client.actions.getByDateRange(startDate, endDate, options.workspace);

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
        const kanbanStatus = options.status as KanbanStatus | undefined;

        const actions = await client.actions.getKanban({
          projectId: options.project,
          status: kanbanStatus,
          assigneeId: options.assignee,
        });

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

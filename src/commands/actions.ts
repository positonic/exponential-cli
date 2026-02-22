import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputActionsJson,
  outputActionsPretty,
  outputActionJson,
  outputActionPretty,
} from '../utils/output.js';
import type { Action, KanbanStatus, Priority } from 'exponential-sdk';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
  workspace?: string;
}

const VALID_PRIORITIES: Priority[] = [
  'Quick',
  'Scheduled',
  '1st Priority',
  '2nd Priority',
  '3rd Priority',
  '4th Priority',
  '5th Priority',
  'Errand',
  'Remember',
  'Watch',
  'Someday Maybe',
];

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

  actions
    .command('create')
    .description('Create a new action')
    .requiredOption('-n, --name <name>', 'Action name/title')
    .option('-d, --description <text>', 'Action description')
    .option('-p, --project <id>', 'Project ID to assign the action to')
    .option('--priority <priority>', 'Priority (Quick, Scheduled, 1st Priority, etc.)')
    .option('--due <date>', 'Due date (YYYY-MM-DD)')
    .option('--effort <minutes>', 'Effort estimate in minutes', parseInt)
    .action(async (options: {
      name: string;
      description?: string;
      project?: string;
      priority?: string;
      due?: string;
      effort?: number;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        // Validate priority if provided
        if (options.priority && !VALID_PRIORITIES.includes(options.priority as Priority)) {
          throw new Error(`Invalid priority "${options.priority}". Valid values: ${VALID_PRIORITIES.join(', ')}`);
        }

        // Parse due date if provided
        let dueDate: Date | undefined;
        if (options.due) {
          dueDate = new Date(options.due);
          if (isNaN(dueDate.getTime())) {
            throw new Error('Invalid due date format. Use YYYY-MM-DD');
          }
        }

        const client = getClient();
        const action = await client.actions.create({
          name: options.name,
          description: options.description,
          projectId: options.project,
          priority: options.priority as Priority | undefined,
          dueDate,
          effortEstimate: options.effort,
        });

        if (useJson) {
          outputActionJson(action);
        } else {
          outputActionPretty(action);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return actions;
}

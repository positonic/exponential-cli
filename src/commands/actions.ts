import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputActionsJson,
  outputActionsPretty,
  outputActionJson,
  outputActionPretty,
  outputCommentJson,
  outputCommentPretty,
  outputCommentsJson,
  outputCommentsPretty,
  outputTodaysActionsJson,
  outputTodaysActionsPretty,
  outputOverdueTriageJson,
  outputOverdueTriagePretty,
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

/** `undefined` = leave alone, `null` = clear, otherwise the parsed date. */
function parseNullableDate(raw: string | undefined, flag: string): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'null') return null;
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid --${flag} value "${raw}". Use YYYY-MM-DD, an ISO datetime, or "null".`);
  }
  return parsed;
}

function parseIds(raw: string): string[] {
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('No action IDs supplied. Pass --ids id1,id2');
  }
  return ids;
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
    .description("What's on your plate: overdue, today, and inbox")
    .option('--workspace <id>', 'Filter by workspace ID')
    .option('--due-only', 'Only actions whose dueDate is today (the pre-1.8 shape — excludes overdue)')
    .action(async (options: { workspace?: string; dueOnly?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();

        if (options.dueOnly) {
          const actions = await client.actions.getToday(options.workspace);
          if (useJson) {
            outputActionsJson(actions, { workspaceId: options.workspace });
          } else {
            outputActionsPretty(actions);
          }
          return;
        }

        const todays = await client.actions.getTodaysActions(options.workspace);
        if (useJson) {
          outputTodaysActionsJson(todays, { workspaceId: options.workspace });
        } else {
          outputTodaysActionsPretty(todays);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  actions
    .command('overdue')
    .description('Why the overdue pile is that size: bulk-created cohorts vs real debt')
    .option('--workspace <id>', 'Filter by workspace ID')
    .action(async (options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const triage = await client.actions.getOverdueTriage(options.workspace);

        if (useJson) {
          outputOverdueTriageJson(triage);
        } else {
          outputOverdueTriagePretty(triage);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  actions
    .command('defer')
    .description('Amnesty: clear dates so actions fall back to their project backlog untimed')
    .requiredOption('--ids <ids>', 'Comma-separated action IDs')
    .action(async (options: { ids: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const ids = parseIds(options.ids);
        const client = getClient();
        const result = await client.actions.bulkDefer(ids);

        if (useJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`✓ ${result.message}`);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  actions
    .command('reschedule')
    .description('Move actions to a new do-date (use "actions defer" if they were never really due)')
    .requiredOption('--ids <ids>', 'Comma-separated action IDs')
    .requiredOption('--to <date>', 'New do-date (YYYY-MM-DD, or "today")')
    .action(async (options: { ids: string; to: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const ids = parseIds(options.ids);
        const when = options.to === 'today' ? new Date() : new Date(options.to);
        if (isNaN(when.getTime())) {
          throw new Error('Invalid date format. Use YYYY-MM-DD or "today"');
        }

        const client = getClient();
        const result = await client.actions.bulkReschedule(ids, when);

        if (useJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`✓ Rescheduled ${result.count} action${result.count === 1 ? '' : 's'}`);
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
    .command('update')
    .description('Update an existing action')
    .requiredOption('--id <id>', 'Action ID to update')
    .option('-n, --name <name>', 'New action name')
    .option('-d, --description <text>', 'New description')
    .option('-p, --project <id>', 'Move to project ID')
    .option('--priority <priority>', 'Priority (Quick, Scheduled, 1st Priority, etc.)')
    .option('--status <status>', 'Status (ACTIVE, COMPLETED, CANCELLED)')
    .option('--kanban <status>', 'Kanban status (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE)')
    .option('--due <date>', 'Due date (YYYY-MM-DD or "null" to clear)')
    .option('--scheduled-start <datetime>', 'Do-date: when you plan to work on it (YYYY-MM-DD, ISO datetime, or "null" to clear). This is what /today partitions on.')
    .option('--scheduled-end <datetime>', 'End of the time block (YYYY-MM-DD, ISO datetime, or "null" to clear)')
    .action(async (options: {
      id: string;
      name?: string;
      description?: string;
      project?: string;
      priority?: string;
      status?: string;
      kanban?: string;
      due?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        // Validate priority if provided
        if (options.priority && !VALID_PRIORITIES.includes(options.priority as Priority)) {
          throw new Error(`Invalid priority "${options.priority}". Valid values: ${VALID_PRIORITIES.join(', ')}`);
        }

        // Parse due date if provided
        let dueDate: Date | null | undefined;
        if (options.due === 'null') {
          dueDate = null;
        } else if (options.due) {
          dueDate = new Date(options.due);
          if (isNaN(dueDate.getTime())) {
            throw new Error('Invalid due date format. Use YYYY-MM-DD');
          }
        }

        const scheduledStart = parseNullableDate(options.scheduledStart, 'scheduled-start');
        const scheduledEnd = parseNullableDate(options.scheduledEnd, 'scheduled-end');

        const client = getClient();
        const action = await client.actions.update({
          id: options.id,
          name: options.name,
          description: options.description,
          projectId: options.project,
          priority: options.priority as Priority | undefined,
          status: options.status as 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | undefined,
          kanbanStatus: options.kanban as 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'CANCELLED' | undefined,
          dueDate,
          scheduledStart,
          scheduledEnd,
        });

        if (useJson) {
          outputActionJson(action);
        } else {
          console.log('\n✓ Action updated successfully');
          outputActionPretty(action);
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
    .option('--ticket <id>', 'Link action to a product ticket (CUID) after creation')
    .option('--epic <id>', 'Epic CUID to attach the action to')
    .action(async (options: {
      name: string;
      description?: string;
      project?: string;
      priority?: string;
      due?: string;
      effort?: number;
      ticket?: string;
      epic?: string;
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
        let action = await client.actions.create({
          name: options.name,
          description: options.description,
          projectId: options.project,
          priority: options.priority as Priority | undefined,
          dueDate,
          effortEstimate: options.effort,
          epicId: options.epic,
        });

        // The server's action.create router doesn't accept ticketId, so when
        // --ticket is requested we link via the product.ticket.linkAction RPC
        // and re-use its updated return value.
        if (options.ticket) {
          action = await client.tickets.linkAction(options.ticket, action.id);
        }

        if (useJson) {
          outputActionJson(action);
        } else {
          console.log('\n✓ Action created successfully');
          outputActionPretty(action);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  const comment = new Command('comment')
    .description('Manage comments on an action');

  comment
    .command('list')
    .description('List comments on an action')
    .requiredOption('--id <id>', 'Action ID')
    .action(async (options: { id: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const comments = await client.actionComments.list(options.id);
        if (useJson) outputCommentsJson(comments);
        else outputCommentsPretty(comments);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('add')
    .description('Add a comment to an action')
    .requiredOption('--id <id>', 'Action ID')
    .requiredOption('-m, --message <text>', 'Comment content (markdown supported)')
    .action(async (options: { id: string; message: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const created = await client.actionComments.add({
          actionId: options.id,
          content: options.message,
        });
        if (useJson) {
          outputCommentJson(created);
        } else {
          console.log('\n✓ Comment added');
          outputCommentPretty(created);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('update')
    .description("Update one of your own comments")
    .requiredOption('--comment-id <id>', 'Comment ID')
    .requiredOption('-m, --message <text>', 'New comment content')
    .action(async (options: { commentId: string; message: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const updated = await client.actionComments.update({
          commentId: options.commentId,
          content: options.message,
        });
        if (useJson) {
          outputCommentJson(updated);
        } else {
          console.log('\n✓ Comment updated');
          outputCommentPretty(updated);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('delete')
    .description("Delete one of your own comments")
    .requiredOption('--comment-id <id>', 'Comment ID')
    .action(async (options: { commentId: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.actionComments.delete(options.commentId);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id: options.commentId }, null, 2));
        } else {
          console.log('\n✓ Comment deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  actions.addCommand(comment);

  return actions;
}

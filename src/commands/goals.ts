import { Command } from 'commander';
import type { GoalStatus, GoalWritableStatus } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import { createKeyResultsCommand } from './keyResults.js';
import {
  applyMentions,
  collectMention,
  MENTION_OPTION_DESCRIPTION,
} from '../utils/mentions.js';
import {
  shouldUseJson,
  outputCommentJson,
  outputCommentPretty,
  outputCommentsJson,
  outputCommentsPretty,
  outputGoalJson,
  outputGoalPeriodsJson,
  outputGoalPeriodsPretty,
  outputGoalPretty,
  outputGoalStatsJson,
  outputGoalStatsPretty,
  outputGoalTreeJson,
  outputGoalTreePretty,
  outputGoalsJson,
  outputGoalsPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

/** Statuses `goals set-status` accepts. `on-hold` lives only on this path. */
const GOAL_STATUSES: GoalStatus[] = [
  'planned',
  'active',
  'completed',
  'archived',
  'on-hold',
];

/** The subset the general update path accepts. */
const GOAL_WRITABLE_STATUSES: GoalWritableStatus[] = [
  'planned',
  'active',
  'completed',
  'archived',
];

function validateGoalStatus(value: string | undefined): GoalStatus | undefined {
  if (!value) return undefined;
  if (!(GOAL_STATUSES as string[]).includes(value)) {
    throw new Error(
      `Invalid goal status "${value}". Valid: ${GOAL_STATUSES.join(', ')}`,
    );
  }
  return value as GoalStatus;
}

function validateWritableGoalStatus(
  value: string | undefined,
): GoalWritableStatus | undefined {
  if (!value) return undefined;
  if (!(GOAL_WRITABLE_STATUSES as string[]).includes(value)) {
    const hint =
      value === 'on-hold'
        ? ' Use `exponential goals set-status --status on-hold` for that one.'
        : '';
    throw new Error(
      `Invalid goal status "${value}". Valid: ${GOAL_WRITABLE_STATUSES.join(', ')}.${hint}`,
    );
  }
  return value as GoalWritableStatus;
}

/**
 * Goal ids are integers, not cuids — the CLI parses them here so a typo fails
 * with a readable message instead of a server-side zod error.
 */
function parseGoalId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new Error(
      `Goal id must be a whole number, got "${value}". Find one with \`exponential search "<goal title>"\`.`,
    );
  }
  return id;
}

/**
 * Flags that can clear a field: `"none"` becomes an explicit `null`, an absent
 * flag stays `undefined` so the SDK never names it on the wire.
 */
function nullable(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === 'none' ? null : value;
}

function parseGoalDate(value: string | undefined): Date | undefined {
  if (!value || value === 'none') return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD`);
  }
  return date;
}

/**
 * `exponential goals …` — objectives, their key results (`goals kr …`) and the
 * discussion on them (`goals comment …`).
 *
 * Objectives carry integer ids and key results carry cuids; the split is the
 * one thing to keep straight here. Status changes route through `set-status`
 * (a single-column write), never through `update`.
 */
export function createGoalsCommand(): Command {
  const goals = new Command('goals').description(
    'Manage objectives (goals) and their key results. Ids are integers — find one with `exponential goals list` or `exponential search "<title>"`.',
  );

  goals
    .command('list')
    .description('List objectives in a workspace')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .option('--period <period>', 'Filter by period, e.g. Q3-2026')
    .option('--status <status>', `Filter by status: ${GOAL_STATUSES.join(', ')}`)
    .option('--tree', 'Render the parent → child cascade instead of a flat list')
    .option(
      '--mine',
      'List your own objectives, including personal ones outside any workspace',
    )
    .action(
      async (
        options: {
          workspace?: string;
          period?: string;
          status?: string;
          tree?: boolean;
          mine?: boolean;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateGoalStatus(options.status);
          const client = getClient();
          // --mine drops the workspace scope entirely: the server reads that as
          // "the caller's own goals", which is the only way to see personal ones.
          const workspaceId = options.mine
            ? undefined
            : await resolveWorkspaceId(client, options.workspace);

          if (options.tree) {
            const tree = await client.goals.tree({ workspaceId, status });
            if (useJson) outputGoalTreeJson(tree);
            else outputGoalTreePretty(tree);
            return;
          }

          const list = await client.goals.list({
            workspaceId,
            period: options.period,
            status,
          });
          if (useJson) outputGoalsJson(list);
          else outputGoalsPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  goals
    .command('get <id>')
    .description('Get an objective by its integer id')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const goal = await client.goals.get(parseGoalId(id));
        if (useJson) outputGoalJson(goal);
        else outputGoalPretty(goal);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('create')
    .description('Create an objective')
    .requiredOption('-t, --title <text>', 'Objective title')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .option(
      '--personal',
      'Create the objective outside any workspace (visible only to you)',
    )
    .option('--period <period>', 'Period, e.g. Q3-2026 or Annual-2026')
    .option('--status <status>', `Status: ${GOAL_WRITABLE_STATUSES.join(', ')} (default active)`)
    .option('-d, --description <text>', 'Description')
    .option('--why <text>', 'Why this objective matters')
    .option('--due <date>', 'Due date (YYYY-MM-DD)')
    .option('--dri <userId>', 'Directly responsible individual')
    .option('--parent <id>', 'Nest under a parent objective (max depth 5)')
    .option('--project <cuid>', 'Link a project on creation')
    .action(
      async (
        options: {
          title: string;
          workspace?: string;
          personal?: boolean;
          period?: string;
          status?: string;
          description?: string;
          why?: string;
          due?: string;
          dri?: string;
          parent?: string;
          project?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateWritableGoalStatus(options.status);
          const client = getClient();
          const workspaceId = options.personal
            ? undefined
            : await resolveWorkspaceId(client, options.workspace);
          const created = await client.goals.create({
            title: options.title,
            workspaceId,
            period: options.period,
            status,
            description: options.description,
            whyThisGoal: options.why,
            dueDate: parseGoalDate(options.due),
            driUserId: options.dri,
            parentGoalId: options.parent ? parseGoalId(options.parent) : undefined,
            projectId: options.project,
          });
          if (useJson) outputGoalJson(created);
          else {
            console.log('\n✓ Objective created');
            outputGoalPretty(created);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  goals
    .command('update')
    .description(
      'Update an objective. Only the fields you pass are written — everything else is left alone.',
    )
    .requiredOption('--id <id>', 'Objective id (a number)')
    .option('-t, --title <text>', 'New title')
    .option('-d, --description <text>', 'New description ("none" clears it)')
    .option('--why <text>', 'Why this objective matters ("none" clears it)')
    .option('--period <period>', 'Period, e.g. Q3-2026 ("none" clears it)')
    .option('--due <date>', 'Due date (YYYY-MM-DD, or "none" to clear)')
    .option('--dri <userId>', 'Directly responsible individual ("none" clears it)')
    .option(
      '--workspace <slug|id|none>',
      'Re-home the objective; "none" makes it personal',
    )
    .option(
      '--status <status>',
      `Status: ${GOAL_WRITABLE_STATUSES.join(', ')}. Prefer \`goals set-status\`.`,
    )
    .action(
      async (
        options: {
          id: string;
          title?: string;
          description?: string;
          why?: string;
          period?: string;
          due?: string;
          dri?: string;
          workspace?: string;
          status?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateWritableGoalStatus(options.status);
          const client = getClient();

          // "none" is the only way to clear a field; an omitted flag must stay
          // omitted all the way to the wire, or it clobbers what it never named.
          let workspaceId: string | null | undefined;
          if (options.workspace === 'none') workspaceId = null;
          else if (options.workspace !== undefined) {
            workspaceId = await resolveWorkspaceId(client, options.workspace);
          }

          const updated = await client.goals.update({
            id: parseGoalId(options.id),
            title: options.title,
            description: nullable(options.description),
            whyThisGoal: nullable(options.why),
            period: nullable(options.period),
            dueDate: options.due === 'none' ? null : parseGoalDate(options.due),
            driUserId: nullable(options.dri),
            workspaceId,
            status,
          });
          if (useJson) outputGoalJson(updated);
          else {
            console.log('\n✓ Objective updated');
            outputGoalPretty(updated);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  goals
    .command('set-status')
    .description(
      'Change an objective\'s status and nothing else. The safe way to close a quarter.',
    )
    .requiredOption('--id <id>', 'Objective id (a number)')
    .requiredOption('--status <status>', `Status: ${GOAL_STATUSES.join(', ')}`)
    .action(async (options: { id: string; status: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const status = validateGoalStatus(options.status)!;
        const client = getClient();
        const updated = await client.goals.setStatus({
          id: parseGoalId(options.id),
          status,
        });
        if (useJson) outputGoalJson(updated);
        else {
          console.log(`\n✓ Objective is now ${status}`);
          outputGoalPretty(updated);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('close')
    .description(
      'Close an objective (status → completed). Writes only the status column.',
    )
    .requiredOption('--id <id>', 'Objective id (a number)')
    .option(
      '--status <status>',
      'completed (default) or archived',
      'completed',
    )
    .action(async (options: { id: string; status: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        if (options.status !== 'completed' && options.status !== 'archived') {
          throw new Error(
            `\`goals close\` takes --status completed or archived, got "${options.status}". Use \`goals set-status\` for the others.`,
          );
        }
        const client = getClient();
        const updated = await client.goals.setStatus({
          id: parseGoalId(options.id),
          status: options.status,
        });
        if (useJson) outputGoalJson(updated);
        else {
          console.log(`\n✓ Objective ${options.status}`);
          outputGoalPretty(updated);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('reparent')
    .description(
      'Move an objective under a different parent, or detach it. Writes only parentGoalId.',
    )
    .requiredOption('--id <id>', 'Objective id (a number)')
    .requiredOption('--parent <id|none>', 'New parent id, or "none" to detach')
    .action(async (options: { id: string; parent: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const updated = await client.goals.setParent({
          id: parseGoalId(options.id),
          parentGoalId:
            options.parent === 'none' ? null : parseGoalId(options.parent),
        });
        if (useJson) outputGoalJson(updated);
        else {
          console.log(
            options.parent === 'none'
              ? '\n✓ Objective detached from its parent'
              : `\n✓ Objective moved under #${options.parent}`,
          );
          outputGoalPretty(updated);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('delete')
    .description(
      'Delete an objective. Refuses while it still has key results — deleting an ' +
        'objective deletes them too (KeyResult.goalId cascades), taking their ' +
        'check-in history with them.',
    )
    .requiredOption('--id <id>', 'Objective id (a number)')
    .option(
      '--with-key-results',
      'Delete the objective and cascade-delete its key results (destructive)',
    )
    .action(
      async (options: { id: string; withKeyResults?: boolean }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const id = parseGoalId(options.id);
          const client = getClient();
          const goal = await client.goals.get(id);
          const keyResults = goal.keyResults ?? [];
          const children = goal.childGoals ?? [];

          if (keyResults.length > 0 && !options.withKeyResults) {
            const payload = {
              deleted: false,
              id,
              reason: `has ${keyResults.length} key result(s)`,
              keyResults: keyResults.map((kr) => ({ id: kr.id })),
            };
            if (useJson) console.log(JSON.stringify(payload, null, 2));
            else {
              console.error(
                `Objective #${id} has ${keyResults.length} key result(s). Deleting it deletes them too.\n` +
                  'Re-run with --with-key-results to go ahead, or move them with `goals kr update --id <cuid> --goal <other>`.',
              );
            }
            process.exitCode = 1;
            return;
          }

          await client.goals.delete(id);
          const payload = {
            deleted: true,
            id,
            keyResultsDeleted: keyResults.map((kr) => ({ id: kr.id })),
            childGoalsDetached: children.map((c) => ({ id: c.id, title: c.title })),
          };
          if (useJson) console.log(JSON.stringify(payload, null, 2));
          else {
            console.log('✓ Objective deleted');
            if (keyResults.length) {
              console.log(`  ${keyResults.length} key result(s) deleted with it`);
            }
            if (children.length) {
              console.log(`  ${children.length} sub-goal(s) left detached`);
            }
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  goals
    .command('periods')
    .description('List the conventional period strings (quarters, halves, annual)')
    .action(async (_options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const periods = await client.goals.periods();
        if (useJson) outputGoalPeriodsJson(periods);
        else outputGoalPeriodsPretty(periods);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('stats')
    .description('Objective and key result counts, and average progress')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .option('--period <period>', 'Period, e.g. Q3-2026')
    .action(
      async (options: { workspace?: string; period?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const stats = await client.goals.stats({
            workspaceId,
            period: options.period,
          });
          if (useJson) outputGoalStatsJson(stats);
          else outputGoalStatsPretty(stats);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  goals.addCommand(createKeyResultsCommand(parseGoalId));

  const comment = new Command('comment').description(
    'Read and post comments on a goal. Mention teammates with --mention.',
  );

  comment
    .command('list')
    .description('List comments on a goal')
    .requiredOption('--goal <id>', 'Goal ID (a number)')
    .action(async (options: { goal: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const comments = await client.goalComments.list(parseGoalId(options.goal));
        if (useJson) outputCommentsJson(comments);
        else outputCommentsPretty(comments);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('add')
    .description('Add a comment to a goal')
    .requiredOption('--goal <id>', 'Goal ID (a number)')
    .requiredOption('-m, --message <text>', 'Comment content (markdown supported)')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .option('--parent-update <id>', 'Thread under a specific goal update')
    .action(
      async (
        options: {
          goal: string;
          message: string;
          mention: string[];
          workspace?: string;
          parentUpdate?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const goalId = parseGoalId(options.goal);
          const content =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const created = await client.goalComments.add({
            goalId,
            content,
            parentUpdateId: options.parentUpdate,
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
      },
    );

  comment
    .command('update')
    .description('Update one of your own comments')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .requiredOption('-m, --message <text>', 'New comment content')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .action(
      async (
        options: {
          commentId: string;
          message: string;
          mention: string[];
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const content =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const updated = await client.goalComments.update({
            commentId: options.commentId,
            content,
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
      },
    );

  comment
    .command('rm')
    .description('Delete one of your own comments')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .action(async (options: { commentId: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.goalComments.delete(options.commentId);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id: options.commentId }, null, 2));
        } else {
          console.log('✓ Comment deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals.addCommand(comment);
  return goals;
}

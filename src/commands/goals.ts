import { Command } from 'commander';
import type {
  GoalStatus,
  GoalWritableStatus,
  KeyResultStatus,
  KeyResultUnit,
} from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
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
  outputGoalPretty,
  outputGoalsJson,
  outputGoalsPretty,
  outputGoalTreeJson,
  outputGoalTreePretty,
  outputGoalPeriodsJson,
  outputGoalPeriodsPretty,
  outputGoalStatsJson,
  outputGoalStatsPretty,
  outputKeyResultJson,
  outputKeyResultPretty,
  outputKeyResultsJson,
  outputKeyResultsPretty,
  outputCheckInJson,
  outputCheckInPretty,
  outputObjectivesJson,
  outputObjectivesPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

/** Statuses `goals set-status` / `goals close` accept. */
const GOAL_STATUSES: GoalStatus[] = [
  'planned',
  'active',
  'completed',
  'archived',
  'on-hold',
];

/**
 * Statuses `goals create` / `goals update` accept. `on-hold` is deliberately
 * absent: only `updateGoalStatus` takes it, which is what `set-status` calls.
 */
const GOAL_WRITABLE_STATUSES: GoalWritableStatus[] = [
  'planned',
  'active',
  'completed',
  'archived',
];

const KEY_RESULT_STATUSES: KeyResultStatus[] = [
  'not-started',
  'on-track',
  'at-risk',
  'off-track',
  'achieved',
];

const KEY_RESULT_UNITS: KeyResultUnit[] = [
  'percent',
  'count',
  'currency',
  'hours',
  'custom',
];

/**
 * Objective ids are integers, not cuids — the CLI parses them here so a typo
 * fails with a readable message instead of a server-side zod error.
 */
function parseGoalId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new Error(
      `Goal id must be a whole number, got "${value}". List them with \`exponential goals list\`.`,
    );
  }
  return id;
}

function parseNumber(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a number, got "${value}".`);
  }
  return n;
}

function validateGoalStatus(value: string | undefined): GoalStatus | undefined {
  if (!value) return undefined;
  if (!(GOAL_STATUSES as string[]).includes(value)) {
    throw new Error(`Invalid status "${value}". Valid: ${GOAL_STATUSES.join(', ')}`);
  }
  return value as GoalStatus;
}

function validateWritableGoalStatus(
  value: string | undefined,
): GoalWritableStatus | undefined {
  if (!value) return undefined;
  if (!(GOAL_WRITABLE_STATUSES as string[]).includes(value)) {
    const extra = value === 'on-hold' ? ' Use `goals set-status` for on-hold.' : '';
    throw new Error(
      `Invalid status "${value}". Valid: ${GOAL_WRITABLE_STATUSES.join(', ')}.${extra}`,
    );
  }
  return value as GoalWritableStatus;
}

function validateKeyResultStatus(
  value: string | undefined,
): KeyResultStatus | undefined {
  if (!value) return undefined;
  if (!(KEY_RESULT_STATUSES as string[]).includes(value)) {
    throw new Error(
      `Invalid status "${value}". Valid: ${KEY_RESULT_STATUSES.join(', ')}`,
    );
  }
  return value as KeyResultStatus;
}

function validateKeyResultUnit(value: string | undefined): KeyResultUnit | undefined {
  if (!value) return undefined;
  if (!(KEY_RESULT_UNITS as string[]).includes(value)) {
    throw new Error(`Invalid unit "${value}". Valid: ${KEY_RESULT_UNITS.join(', ')}`);
  }
  return value as KeyResultUnit;
}

/**
 * `exponential goals kr …` — key results.
 *
 * Kept as a subtree of `goals` because a key result is meaningless without its
 * objective, and because the tRPC router mounted at `okr` is the KEY RESULT
 * router — naming the group `kr` keeps that straight. Ids here are cuids; the
 * `--goal` they hang off is an integer.
 */
function createKeyResultsCommand(): Command {
  const kr = new Command('kr').description(
    'Key results on an objective. Ids are CUIDs; --goal takes the objective\'s integer id.',
  );

  kr.command('list')
    .description('List key results')
    .option('--goal <id>', 'Objective ID (a number)')
    .option('--workspace <slug|id>', 'Workspace (workspace-wide: every member\'s KRs)')
    .option('--period <period>', 'Period, e.g. Q3-2026')
    .option('--status <status>', `Filter by status: ${KEY_RESULT_STATUSES.join(', ')}`)
    .option('--mine', 'Narrow a workspace list to key results you own')
    .action(
      async (
        options: {
          goal?: string;
          workspace?: string;
          period?: string;
          status?: string;
          mine?: boolean;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateKeyResultStatus(options.status);
          const client = getClient();
          // No --workspace and no --goal keeps this the caller's personal list;
          // resolving a default workspace here would silently widen it.
          const workspaceId = options.workspace
            ? await resolveWorkspaceId(client, options.workspace)
            : undefined;
          const list = await client.goals.keyResults.list({
            workspaceId,
            goalId: options.goal ? parseGoalId(options.goal) : undefined,
            period: options.period,
            status,
            onlyMine: options.mine,
          });
          if (useJson) outputKeyResultsJson(list);
          else outputKeyResultsPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr.command('get <id>')
    .description('Get a key result by CUID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const keyResult = await getClient().goals.keyResults.get(id);
        if (useJson) outputKeyResultJson(keyResult);
        else outputKeyResultPretty(keyResult);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  kr.command('create')
    .description('Create a key result on an objective')
    .requiredOption('--goal <id>', 'Objective ID (a number)')
    .requiredOption('-t, --title <text>', 'Key result title')
    .requiredOption('--target <n>', 'Target value')
    .option('--start <n>', 'Starting value (default 0)')
    .option('--current <n>', 'Current value (defaults to the start value)')
    .option('--unit <unit>', `Unit: ${KEY_RESULT_UNITS.join(', ')}`)
    .option('--period <period>', 'Period, e.g. Q3-2026 (defaults to the objective\'s)')
    .option('-d, --description <text>', 'Description')
    .option('--dri <userId>', 'Directly responsible individual (user ID)')
    .action(
      async (
        options: {
          goal: string;
          title: string;
          target: string;
          start?: string;
          current?: string;
          unit?: string;
          period?: string;
          description?: string;
          dri?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const unit = validateKeyResultUnit(options.unit);
          const client = getClient();
          const goalId = parseGoalId(options.goal);
          const startValue = options.start
            ? parseNumber(options.start, '--start')
            : undefined;

          // `period` is required by the server but is a property of the OKR
          // cycle, not of the individual KR — fall back to the objective's so
          // the common case needs one less flag.
          let period = options.period;
          if (!period) {
            const goal = await client.goals.get(goalId);
            if (!goal.period) {
              throw new Error(
                `Objective #${goalId} has no period, so --period is required. See \`exponential goals periods\`.`,
              );
            }
            period = goal.period;
          }

          const keyResult = await client.goals.keyResults.create({
            goalId,
            title: options.title,
            targetValue: parseNumber(options.target, '--target'),
            startValue,
            currentValue: options.current
              ? parseNumber(options.current, '--current')
              : startValue,
            unit,
            period,
            description: options.description,
            driUserId: options.dri,
          });
          if (useJson) outputKeyResultJson(keyResult);
          else {
            console.log('\n✓ Key result created');
            outputKeyResultPretty(keyResult);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr.command('update')
    .description('Update a key result (only the flags you pass are written)')
    .requiredOption('--id <cuid>', 'Key result CUID')
    .option('-t, --title <text>', 'New title')
    .option('-d, --description <text>', 'New description')
    .option('--current <n>', 'Current value (prefer `kr checkin` — it records history)')
    .option('--target <n>', 'Target value')
    .option('--start <n>', 'Starting value')
    .option('--unit <unit>', `Unit: ${KEY_RESULT_UNITS.join(', ')}`)
    .option('--status <status>', `Status: ${KEY_RESULT_STATUSES.join(', ')}`)
    .option('--confidence <n>', 'Confidence 0-100')
    .option('--dri <userId>', 'Directly responsible individual (user ID)')
    .option('--goal <id>', 'Move the key result to a different objective')
    .action(
      async (
        options: {
          id: string;
          title?: string;
          description?: string;
          current?: string;
          target?: string;
          start?: string;
          unit?: string;
          status?: string;
          confidence?: string;
          dri?: string;
          goal?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateKeyResultStatus(options.status);
          const unit = validateKeyResultUnit(options.unit);
          const keyResult = await getClient().goals.keyResults.update({
            id: options.id,
            title: options.title,
            description: options.description,
            currentValue: options.current
              ? parseNumber(options.current, '--current')
              : undefined,
            targetValue: options.target
              ? parseNumber(options.target, '--target')
              : undefined,
            startValue: options.start
              ? parseNumber(options.start, '--start')
              : undefined,
            unit,
            status,
            confidence: options.confidence
              ? parseNumber(options.confidence, '--confidence')
              : undefined,
            driUserId: options.dri,
            goalId: options.goal ? parseGoalId(options.goal) : undefined,
          });
          if (useJson) outputKeyResultJson(keyResult);
          else {
            console.log('\n✓ Key result updated');
            outputKeyResultPretty(keyResult);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr.command('checkin')
    .description(
      'Record a progress check-in. Moves the value AND re-derives the status ' +
        'from where it lands between start and target.',
    )
    .requiredOption('--id <cuid>', 'Key result CUID')
    .requiredOption('--value <n>', 'New current value')
    .option('--note <text>', 'Check-in note')
    .action(
      async (
        options: { id: string; value: string; note?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const checkIn = await getClient().goals.keyResults.checkIn({
            id: options.id,
            value: parseNumber(options.value, '--value'),
            note: options.note,
          });
          if (useJson) outputCheckInJson(checkIn);
          else {
            console.log('\n✓ Check-in recorded');
            outputCheckInPretty(checkIn);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr.command('delete')
    .description('Delete a key result')
    .requiredOption('--id <cuid>', 'Key result CUID')
    .action(async (options: { id: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        await getClient().goals.keyResults.delete(options.id);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id: options.id }, null, 2));
        } else {
          console.log('✓ Key result deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  kr.command('link')
    .description('Link executing work (a project or a feature) to a key result')
    .requiredOption('--id <cuid>', 'Key result CUID')
    .option('--project <cuid>', 'Project CUID')
    .option('--feature <cuid>', 'Feature CUID')
    .action(
      async (
        options: { id: string; project?: string; feature?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!options.project === !options.feature) {
            throw new Error('Pass exactly one of --project or --feature.');
          }
          const client = getClient();
          const result = options.project
            ? await client.goals.keyResults.linkProject({
                keyResultId: options.id,
                projectId: options.project,
              })
            : await client.goals.keyResults.linkFeature({
                keyResultId: options.id,
                featureId: options.feature!,
              });
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else console.log(`\n✓ ${options.project ? 'Project' : 'Feature'} linked`);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr.command('unlink')
    .description('Unlink a project or feature from a key result')
    .requiredOption('--id <cuid>', 'Key result CUID')
    .option('--project <cuid>', 'Project CUID')
    .option('--feature <cuid>', 'Feature CUID')
    .action(
      async (
        options: { id: string; project?: string; feature?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!options.project === !options.feature) {
            throw new Error('Pass exactly one of --project or --feature.');
          }
          const client = getClient();
          const result = options.project
            ? await client.goals.keyResults.unlinkProject({
                keyResultId: options.id,
                projectId: options.project,
              })
            : await client.goals.keyResults.unlinkFeature({
                keyResultId: options.id,
                featureId: options.feature!,
              });
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else console.log(`\n✓ ${options.project ? 'Project' : 'Feature'} unlinked`);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  return kr;
}

function createGoalCommentsCommand(): Command {
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

  return comment;
}

/**
 * `exponential goals …` — objectives (`Goal`, integer ids), their key results,
 * and their comments.
 *
 * Three separate write paths on purpose. `update` is a partial update that
 * sends only the flags you pass; `set-status`/`close` route through the
 * status-only procedure; `reparent` writes the parent alone. Closing a quarter
 * or moving a goal in the cascade should never risk a collateral write — an
 * agent once archived a goal with a title-and-status update and orphaned it out
 * of its workspace in the process.
 */
export function createGoalsCommand(): Command {
  const goals = new Command('goals').description(
    'Manage goals (objectives) and their key results. Objectives have integer ids; key results are CUIDs.',
  );

  goals
    .command('list')
    .description('List objectives in a workspace')
    .option('--workspace <slug|id>', 'Workspace slug or ID (defaults to your default workspace)')
    .option('--period <period>', 'Filter by period, e.g. Q3-2026')
    .option('--status <status>', `Filter by status: ${GOAL_STATUSES.join(', ')}`)
    .option('--tree', 'Render the parent/child cascade instead of a flat list')
    .action(
      async (
        options: {
          workspace?: string;
          period?: string;
          status?: string;
          tree?: boolean;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateGoalStatus(options.status);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);

          if (options.tree) {
            // getGoalTree has no period filter, so --period is applied here.
            // It only prunes roots — a matching child under a non-matching
            // parent would otherwise vanish, which is the opposite of what a
            // cascade view is for.
            const tree = await client.goals.tree({ workspaceId, status });
            const filtered = options.period
              ? tree.filter((g) => g.period === options.period)
              : tree;
            if (useJson) outputGoalTreeJson(filtered);
            else outputGoalTreePretty(filtered);
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
    .description('Get an objective by its integer ID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const goal = await getClient().goals.get(parseGoalId(id));
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
    .option('--workspace <slug|id>', 'Workspace slug or ID (defaults to your default workspace)')
    .option('--period <period>', 'Period, e.g. Q3-2026 or Annual-2026')
    .option('--status <status>', `Status: ${GOAL_WRITABLE_STATUSES.join(', ')}`)
    .option('-d, --description <text>', 'Description (markdown supported)')
    .option('--why <text>', 'Why this goal matters')
    .option('--dri <userId>', 'Directly responsible individual (user ID)')
    .option('--parent <id>', 'Parent objective ID to nest under (max depth 5)')
    .option('--project <cuid>', 'Link a project on creation')
    .action(
      async (
        options: {
          title: string;
          workspace?: string;
          period?: string;
          status?: string;
          description?: string;
          why?: string;
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
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const goal = await client.goals.create({
            title: options.title,
            workspaceId,
            period: options.period,
            status,
            description: options.description,
            whyThisGoal: options.why,
            driUserId: options.dri,
            parentGoalId: options.parent ? parseGoalId(options.parent) : undefined,
            projectId: options.project,
          });
          if (useJson) outputGoalJson(goal);
          else {
            console.log('\n✓ Goal created');
            outputGoalPretty(goal);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  goals
    .command('update')
    .description(
      'Update an objective. Only the flags you pass are written — everything ' +
        'else is left exactly as it is. For a status change use `set-status`; ' +
        'to re-parent use `reparent`.',
    )
    .requiredOption('--id <n>', 'Objective ID (a number)')
    .option('-t, --title <text>', 'New title')
    .option('-d, --description <text>', 'New description ("none" clears it)')
    .option('--why <text>', 'Why this goal matters ("none" clears it)')
    .option('--period <period>', 'New period ("none" clears it)')
    .option('--dri <userId>', 'Directly responsible individual (user ID)')
    .option('--status <status>', `Status: ${GOAL_WRITABLE_STATUSES.join(', ')}`)
    .option('--project <cuid>', 'Replace the project links with this project ("none" clears them)')
    .action(
      async (
        options: {
          id: string;
          title?: string;
          description?: string;
          why?: string;
          period?: string;
          dri?: string;
          status?: string;
          project?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateWritableGoalStatus(options.status);
          // "none" is the CLI's way of saying the explicit null the API wants;
          // an omitted flag stays `undefined` and is never sent.
          const clearable = (value: string | undefined) =>
            value === undefined ? undefined : value === 'none' ? null : value;
          const goal = await getClient().goals.update({
            id: parseGoalId(options.id),
            title: options.title,
            description: clearable(options.description),
            whyThisGoal: clearable(options.why),
            period: clearable(options.period),
            driUserId: options.dri,
            status,
            projectId: clearable(options.project),
          });
          if (useJson) outputGoalJson(goal);
          else {
            console.log('\n✓ Goal updated');
            outputGoalPretty(goal);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  goals
    .command('set-status')
    .description(
      'Set an objective\'s status and nothing else. Routes through the ' +
        'status-only procedure, so no other field can be touched.',
    )
    .requiredOption('--id <n>', 'Objective ID (a number)')
    .requiredOption('--status <status>', `Status: ${GOAL_STATUSES.join(', ')}`)
    .action(async (options: { id: string; status: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const status = validateGoalStatus(options.status)!;
        const goal = await getClient().goals.setStatus({
          id: parseGoalId(options.id),
          status,
        });
        if (useJson) outputGoalJson(goal);
        else {
          console.log(`\n✓ Goal status set to ${status}`);
          outputGoalPretty(goal);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('close')
    .description('Close out an objective — one command per goal when a quarter ends')
    .requiredOption('--id <n>', 'Objective ID (a number)')
    .option('--status <status>', 'completed (default) or archived', 'completed')
    .action(async (options: { id: string; status: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const status = validateGoalStatus(options.status)!;
        // Same status-only path as set-status — never `updateGoal`.
        const goal = await getClient().goals.setStatus({
          id: parseGoalId(options.id),
          status,
        });
        if (useJson) outputGoalJson(goal);
        else {
          console.log(`\n✓ Goal closed as ${status}`);
          outputGoalPretty(goal);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('reparent')
    .description(
      'Move an objective under another (or detach it with --parent none). ' +
        'Writes the parent alone.',
    )
    .requiredOption('--id <n>', 'Objective ID (a number)')
    .requiredOption('--parent <id|none>', 'New parent objective ID, or "none" to detach')
    .action(async (options: { id: string; parent: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const goal = await getClient().goals.setParent({
          id: parseGoalId(options.id),
          parentGoalId: options.parent === 'none' ? null : parseGoalId(options.parent),
        });
        if (useJson) outputGoalJson(goal);
        else {
          console.log(
            options.parent === 'none' ? '\n✓ Goal detached' : '\n✓ Goal re-parented',
          );
          outputGoalPretty(goal);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('delete')
    .description('Delete an objective')
    .requiredOption('--id <n>', 'Objective ID (a number)')
    .action(async (options: { id: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const id = parseGoalId(options.id);
        await getClient().goals.delete(id);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id }, null, 2));
        } else {
          console.log('✓ Goal deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('periods')
    .description('List the conventional OKR period strings')
    .action(async (_options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const periods = await getClient().goals.periods();
        if (useJson) outputGoalPeriodsJson(periods);
        else outputGoalPeriodsPretty(periods);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals
    .command('stats')
    .description('Objective and key-result counts, average progress and confidence')
    .option('--workspace <slug|id>', 'Workspace slug or ID (defaults to your default workspace)')
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

  goals.addCommand(createKeyResultsCommand());
  goals.addCommand(createGoalCommentsCommand());
  return goals;
}

/**
 * `exponential okrs …` — the objective-plus-key-results view.
 *
 * `goals list` answers "what are the objectives"; `okrs list` answers "how is
 * the quarter going", nesting each objective's key results underneath it in one
 * workspace-scoped call. Everything you can do to the parts still lives under
 * `goals` / `goals kr` — this group is the combined read.
 */
export function createOkrsCommand(): Command {
  const okrs = new Command('okrs').description(
    'OKRs — objectives with their key results nested. Manage the parts with `goals` and `goals kr`.',
  );

  okrs
    .command('list')
    .description('List objectives with their key results')
    .option('--workspace <slug|id>', 'Workspace slug or ID (defaults to your default workspace)')
    .option('--period <period>', 'Period, e.g. Q3-2026')
    .option('--paired-period', 'Also include the period\'s parent annual period')
    .option('--mine', 'Only objectives and key results you are the DRI for')
    .action(
      async (
        options: {
          workspace?: string;
          period?: string;
          pairedPeriod?: boolean;
          mine?: boolean;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const objectives = await client.goals.keyResults.byObjective({
            workspaceId,
            period: options.period,
            includePairedPeriod: options.pairedPeriod,
            onlyMine: options.mine,
          });
          if (useJson) outputObjectivesJson(objectives);
          else outputObjectivesPretty(objectives);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  okrs
    .command('stats')
    .description('Objective and key-result counts, average progress and confidence')
    .option('--workspace <slug|id>', 'Workspace slug or ID (defaults to your default workspace)')
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

  okrs
    .command('periods')
    .description('List the conventional OKR period strings')
    .action(async (_options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const periods = await getClient().goals.periods();
        if (useJson) outputGoalPeriodsJson(periods);
        else outputGoalPeriodsPretty(periods);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  okrs.addCommand(createKeyResultsCommand());
  return okrs;
}

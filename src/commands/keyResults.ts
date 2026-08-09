import { Command } from 'commander';
import type { KeyResultStatus, KeyResultUnit } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputCheckInJson,
  outputCheckInPretty,
  outputKeyResultJson,
  outputKeyResultPretty,
  outputKeyResultsJson,
  outputKeyResultsPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const KR_STATUSES: KeyResultStatus[] = [
  'not-started',
  'on-track',
  'at-risk',
  'off-track',
  'achieved',
];

const KR_UNITS: KeyResultUnit[] = [
  'percent',
  'count',
  'currency',
  'hours',
  'custom',
];

function validateKeyResultStatus(
  value: string | undefined,
): KeyResultStatus | undefined {
  if (!value) return undefined;
  if (!(KR_STATUSES as string[]).includes(value)) {
    throw new Error(
      `Invalid key result status "${value}". Valid: ${KR_STATUSES.join(', ')}`,
    );
  }
  return value as KeyResultStatus;
}

function validateKeyResultUnit(
  value: string | undefined,
): KeyResultUnit | undefined {
  if (!value) return undefined;
  if (!(KR_UNITS as string[]).includes(value)) {
    throw new Error(
      `Invalid unit "${value}". Valid: ${KR_UNITS.join(', ')}`,
    );
  }
  return value as KeyResultUnit;
}

function parseNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${flag} must be a number, got "${value}"`);
  }
  return n;
}

/**
 * `exponential goals kr …` — the measurable half of an OKR.
 *
 * Key result ids are cuid strings; the `--goal` they hang off is an integer.
 * The tRPC router behind these calls is mounted at `okr`, which is the key
 * result router — objectives are `goals`.
 */
export function createKeyResultsCommand(parseGoalId: (v: string) => number): Command {
  const kr = new Command('kr').description(
    'Manage key results on an objective. Ids are CUIDs; --goal takes the objective\'s integer id.',
  );

  kr
    .command('list')
    .description('List key results, by objective or across a workspace')
    .option('--goal <id>', 'Objective id (a number)')
    .option(
      '--workspace <slug|id>',
      'Workspace slug or CUID — lists every member\'s key results',
    )
    .option('--period <period>', 'Filter by period, e.g. Q3-2026')
    .option('--status <status>', `Filter by status: ${KR_STATUSES.join(', ')}`)
    .option('--mine', 'Narrow a workspace list back to key results you own')
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
          const goalId = options.goal ? parseGoalId(options.goal) : undefined;

          // An unscoped read is owner-scoped server-side, so "the key results on
          // objective #48" would come back empty for anyone but their author.
          // When only --goal is given, borrow the objective's own workspace.
          let workspaceId: string | undefined;
          if (options.workspace) {
            workspaceId = await resolveWorkspaceId(client, options.workspace);
          } else if (goalId !== undefined) {
            const goal = await client.goals.get(goalId);
            workspaceId = goal.workspaceId ?? undefined;
          } else {
            workspaceId = await resolveWorkspaceId(client, undefined);
          }

          const list = await client.keyResults.list({
            workspaceId,
            goalId,
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

  kr
    .command('get <id>')
    .description('Get a key result by CUID, with its check-ins and linked work')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const keyResult = await client.keyResults.get(id);
        if (useJson) outputKeyResultJson(keyResult);
        else outputKeyResultPretty(keyResult);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  kr
    .command('create')
    .description('Create a key result on an objective')
    .requiredOption('--goal <id>', 'Objective id (a number)')
    .requiredOption('-t, --title <text>', 'Key result title')
    .requiredOption('--target <n>', 'Target value')
    .option('--start <n>', 'Starting value (default 0)')
    .option('--current <n>', 'Current value (default 0)')
    .option('--unit <unit>', `Unit: ${KR_UNITS.join(', ')} (default percent)`)
    .option('--unit-label <text>', 'Label for a custom unit')
    .option('-d, --description <text>', 'Description')
    .option(
      '--period <period>',
      "Period, e.g. Q3-2026. Defaults to the objective's own period.",
    )
    .option('--dri <userId>', 'Directly responsible individual')
    .action(
      async (
        options: {
          goal: string;
          title: string;
          target: string;
          start?: string;
          current?: string;
          unit?: string;
          unitLabel?: string;
          description?: string;
          period?: string;
          dri?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const unit = validateKeyResultUnit(options.unit);
          const goalId = parseGoalId(options.goal);
          const client = getClient();

          // The server requires a period. Inheriting the objective's keeps a
          // quarter's key results in one period without the caller retyping it.
          let period = options.period;
          if (!period) {
            const goal = await client.goals.get(goalId);
            if (!goal.period) {
              throw new Error(
                `Objective #${goalId} has no period, so --period is required (e.g. --period Q3-2026).`,
              );
            }
            period = goal.period;
          }

          const created = await client.keyResults.create({
            goalId,
            title: options.title,
            targetValue: parseNumber(options.target, '--target'),
            startValue: options.start
              ? parseNumber(options.start, '--start')
              : undefined,
            currentValue: options.current
              ? parseNumber(options.current, '--current')
              : undefined,
            unit,
            unitLabel: options.unitLabel,
            description: options.description,
            period,
            driUserId: options.dri,
          });
          if (useJson) outputKeyResultJson(created);
          else {
            console.log('\n✓ Key result created');
            outputKeyResultPretty(created);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr
    .command('update')
    .description('Update a key result. Only the fields you pass are written.')
    .requiredOption('--id <cuid>', 'Key result CUID')
    .option('-t, --title <text>', 'New title')
    .option('-d, --description <text>', 'New description')
    .option('--current <n>', 'Current value (no check-in recorded — use `kr checkin` for that)')
    .option('--target <n>', 'Target value')
    .option('--start <n>', 'Starting value')
    .option('--status <status>', `Status: ${KR_STATUSES.join(', ')}`)
    .option('--unit <unit>', `Unit: ${KR_UNITS.join(', ')}`)
    .option('--confidence <n>', 'Confidence 0-100')
    .option('--goal <id>', 'Move the key result to a different objective')
    .option('--dri <userId>', 'Directly responsible individual')
    .action(
      async (
        options: {
          id: string;
          title?: string;
          description?: string;
          current?: string;
          target?: string;
          start?: string;
          status?: string;
          unit?: string;
          confidence?: string;
          goal?: string;
          dri?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateKeyResultStatus(options.status);
          const unit = validateKeyResultUnit(options.unit);
          const client = getClient();
          const updated = await client.keyResults.update({
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
            status,
            unit,
            confidence: options.confidence
              ? parseNumber(options.confidence, '--confidence')
              : undefined,
            goalId: options.goal ? parseGoalId(options.goal) : undefined,
            driUserId: options.dri,
          });
          if (useJson) outputKeyResultJson(updated);
          else {
            console.log('\n✓ Key result updated');
            outputKeyResultPretty(updated);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr
    .command('checkin')
    .description(
      'Record a progress check-in. Moves the value and re-derives the status.',
    )
    .requiredOption('--id <cuid>', 'Key result CUID')
    .requiredOption('--value <n>', 'The new current value')
    .option('--note <text>', 'What changed')
    .action(
      async (
        options: { id: string; value: string; note?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const checkIn = await client.keyResults.checkIn({
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

  kr
    .command('delete')
    .description('Delete a key result and its check-in history')
    .requiredOption('--id <cuid>', 'Key result CUID')
    .action(async (options: { id: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.keyResults.delete(options.id);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id: options.id }, null, 2));
        } else {
          console.log('✓ Key result deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  kr
    .command('link')
    .description(
      'Link executing work to a key result, so delivery rolls up to the OKR',
    )
    .requiredOption('--id <cuid>', 'Key result CUID')
    .option('--project <cuid>', 'Project to link')
    .option('--feature <cuid>', 'Feature to link')
    .action(
      async (
        options: { id: string; project?: string; feature?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!options.project && !options.feature) {
            throw new Error('Pass --project <cuid> or --feature <cuid>');
          }
          const client = getClient();
          if (options.project) {
            await client.keyResults.linkProject({
              keyResultId: options.id,
              projectId: options.project,
            });
          }
          if (options.feature) {
            await client.keyResults.linkFeature({
              keyResultId: options.id,
              featureId: options.feature,
            });
          }
          const payload = {
            linked: true,
            keyResultId: options.id,
            projectId: options.project ?? null,
            featureId: options.feature ?? null,
          };
          if (useJson) console.log(JSON.stringify(payload, null, 2));
          else console.log('✓ Linked to key result');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  kr
    .command('unlink')
    .description('Remove a project or feature link from a key result')
    .requiredOption('--id <cuid>', 'Key result CUID')
    .option('--project <cuid>', 'Project to unlink')
    .option('--feature <cuid>', 'Feature to unlink')
    .action(
      async (
        options: { id: string; project?: string; feature?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!options.project && !options.feature) {
            throw new Error('Pass --project <cuid> or --feature <cuid>');
          }
          const client = getClient();
          if (options.project) {
            await client.keyResults.unlinkProject({
              keyResultId: options.id,
              projectId: options.project,
            });
          }
          if (options.feature) {
            await client.keyResults.unlinkFeature({
              keyResultId: options.id,
              featureId: options.feature,
            });
          }
          const payload = {
            unlinked: true,
            keyResultId: options.id,
            projectId: options.project ?? null,
            featureId: options.feature ?? null,
          };
          if (useJson) console.log(JSON.stringify(payload, null, 2));
          else console.log('✓ Unlinked from key result');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  return kr;
}

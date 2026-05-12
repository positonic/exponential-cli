import { Command } from 'commander';
import type { EpicPriority, EpicStatus } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputEpicJson,
  outputEpicPretty,
  outputEpicsJson,
  outputEpicsPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const EPIC_STATUSES: EpicStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const EPIC_PRIORITIES: EpicPriority[] = ['HIGH', 'MEDIUM', 'LOW', 'NONE'];

function validateEpicStatus(value: string | undefined): EpicStatus | undefined {
  if (!value) return undefined;
  if (!(EPIC_STATUSES as string[]).includes(value)) {
    throw new Error(`Invalid epic status "${value}". Valid: ${EPIC_STATUSES.join(', ')}`);
  }
  return value as EpicStatus;
}

function validateEpicPriority(value: string | undefined): EpicPriority | undefined {
  if (!value) return undefined;
  if (!(EPIC_PRIORITIES as string[]).includes(value)) {
    throw new Error(
      `Invalid epic priority "${value}". Valid: ${EPIC_PRIORITIES.join(', ')}`,
    );
  }
  return value as EpicPriority;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD`);
  }
  return d;
}

export function createEpicsCommand(): Command {
  const epics = new Command('epics').description(
    'Manage epics. Epics are workspace-scoped and group actions and tickets across products.',
  );

  epics
    .command('list')
    .description('List epics in a workspace')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .option('--status <status>', `Filter by status: ${EPIC_STATUSES.join(', ')}`)
    .action(
      async (options: { workspace?: string; status?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateEpicStatus(options.status);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const list = await client.epics.list({ workspaceId, status });
          if (useJson) outputEpicsJson(list);
          else outputEpicsPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  epics
    .command('get <id>')
    .description('Get an epic by CUID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const epic = await client.epics.get(id);
        if (useJson) outputEpicJson(epic);
        else outputEpicPretty(epic);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  epics
    .command('create')
    .description('Create a new epic in a workspace')
    .requiredOption('-n, --name <name>', 'Epic name')
    .option('-d, --description <text>', 'Description')
    .option('--priority <priority>', `Priority: ${EPIC_PRIORITIES.join(', ')}`)
    .option('--start <date>', 'Start date (YYYY-MM-DD)')
    .option('--target <date>', 'Target date (YYYY-MM-DD)')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .action(
      async (
        options: {
          name: string;
          description?: string;
          priority?: string;
          start?: string;
          target?: string;
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const priority = validateEpicPriority(options.priority);
          const startDate = parseDate(options.start);
          const targetDate = parseDate(options.target);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const epic = await client.epics.create({
            workspaceId,
            name: options.name,
            description: options.description,
            priority,
            startDate,
            targetDate,
          });
          if (useJson) outputEpicJson(epic);
          else {
            console.log('\n✓ Epic created');
            outputEpicPretty(epic);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  epics
    .command('update')
    .description('Update an existing epic')
    .requiredOption('--id <id>', 'Epic CUID')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <text>', 'New description (or "null" to clear)')
    .option('--status <status>', `Status: ${EPIC_STATUSES.join(', ')}`)
    .option('--priority <priority>', `Priority: ${EPIC_PRIORITIES.join(', ')}`)
    .option('--start <date>', 'Start date (YYYY-MM-DD or "null")')
    .option('--target <date>', 'Target date (YYYY-MM-DD or "null")')
    .action(
      async (
        options: {
          id: string;
          name?: string;
          description?: string;
          status?: string;
          priority?: string;
          start?: string;
          target?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const parseNullableDate = (v: string | undefined): Date | null | undefined => {
            if (v === undefined) return undefined;
            if (v === 'null') return null;
            const d = new Date(v);
            if (isNaN(d.getTime())) {
              throw new Error(`Invalid date "${v}". Use YYYY-MM-DD`);
            }
            return d;
          };
          const description = options.description === 'null' ? null : options.description;
          const status = validateEpicStatus(options.status);
          const priority = validateEpicPriority(options.priority);
          const client = getClient();
          const epic = await client.epics.update({
            id: options.id,
            name: options.name,
            description,
            status,
            priority,
            startDate: parseNullableDate(options.start),
            targetDate: parseNullableDate(options.target),
          });
          if (useJson) outputEpicJson(epic);
          else {
            console.log('\n✓ Epic updated');
            outputEpicPretty(epic);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  return epics;
}

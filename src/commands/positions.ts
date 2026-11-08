import { Command } from 'commander';
import chalk from 'chalk';
import type { ExponentialClient, Position, PositionImportRow, WorkspaceMember } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import { shouldUseJson } from '../utils/output.js';
import { resolveMember, collectMention } from '../utils/mentions.js';
import { readText } from '../utils/input.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const WORKSPACE_OPTION = ['--workspace <slug|id>', 'Workspace (defaults to your default workspace)'] as const;
const HOLDER_OPTION_DESCRIPTION = 'Holder: a workspace member by name, email, or user id (repeatable)';
const HUMAN_ONLY_NOTE =
  'Writes need your own login (`exponential auth login`); agent keys are refused. ' +
  'Owners and admins can do everything; a member who holds a position may edit its remit.';

/**
 * A position by id, or by title matched case-insensitively. An unknown ref
 * lists what exists rather than guessing.
 */
export function pickPosition(positions: Position[], ref: string): Position {
  const byId = positions.find((p) => p.id === ref);
  if (byId) return byId;
  const needle = ref.trim().toLowerCase();
  const byTitle = positions.find((p) => p.title.toLowerCase() === needle);
  if (byTitle) return byTitle;
  const known = positions.map((p) => `"${p.title}"`).join(', ');
  throw new Error(`No position matches "${ref}". Positions: ${known || '(none)'}`);
}

/** Holder tokens (name, email, id) to user ids, against the workspace roster. */
export function resolveHolderIds(members: WorkspaceMember[], tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => resolveMember(members, token).id))];
}

async function loadPosition(client: ExponentialClient, workspaceId: string, ref: string): Promise<Position> {
  const { positions } = await client.positions.list(workspaceId);
  return pickPosition(positions, ref);
}

function holderLabel(holder: Position['holders'][number]): string {
  return `${holder.name ?? holder.userId}${holder.isAgent ? chalk.gray(' (agent)') : ''}`;
}

function printPosition(position: Position): void {
  console.log(`${chalk.bold(position.title)} ${chalk.gray(`(${position.id})`)}`);
  console.log(
    `  ${chalk.gray('Held by:')} ${position.holders.length ? position.holders.map(holderLabel).join(', ') : chalk.yellow('nobody')}`,
  );
  console.log(`  ${chalk.gray('Remit:')} ${position.remit.replace(/\n/g, '\n    ')}`);
  if (position.notAccountableFor) {
    console.log(`  ${chalk.gray('Not accountable for:')} ${position.notAccountableFor.replace(/\n/g, '\n    ')}`);
  }
  console.log();
}

function output(position: Position, useJson: boolean, verb: string): void {
  if (useJson) {
    console.log(JSON.stringify(position, null, 2));
    return;
  }
  console.log(chalk.green(`${verb}:`));
  printPosition(position);
}

/** One row of an import file: `holders` takes names, emails or ids. */
interface ImportFileRow {
  title?: unknown;
  remit?: unknown;
  notAccountableFor?: unknown;
  holders?: unknown;
  holderUserIds?: unknown;
}

export function parseImportFile(raw: string, members: WorkspaceMember[]): PositionImportRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Import file is not valid JSON: ${(error as Error).message}`);
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed as { positions?: unknown } | null)?.positions;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Import file must be a non-empty JSON array of positions (or {"positions": [...]})');
  }
  return rows.map((row: ImportFileRow, index) => {
    const where = `positions[${index}]`;
    if (typeof row.title !== 'string' || !row.title.trim()) throw new Error(`${where}: "title" is required`);
    if (typeof row.remit !== 'string' || !row.remit.trim()) throw new Error(`${where}: "remit" is required`);
    if (row.notAccountableFor !== undefined && typeof row.notAccountableFor !== 'string') {
      throw new Error(`${where}: "notAccountableFor" must be a string`);
    }
    const tokens = row.holders ?? row.holderUserIds ?? [];
    if (!Array.isArray(tokens) || tokens.some((t) => typeof t !== 'string')) {
      throw new Error(`${where}: "holders" must be an array of names, emails or user ids`);
    }
    return {
      title: row.title,
      remit: row.remit,
      ...(row.notAccountableFor !== undefined && { notAccountableFor: row.notAccountableFor }),
      holderUserIds: resolveHolderIds(members, tokens as string[]),
    };
  });
}

export function createPositionsCommand(): Command {
  const positions = new Command('positions')
    .alias('roles')
    .description(
      "A workspace's roles & responsibilities (Positions): what each role takes on, what it is not " +
        `accountable for, and who holds it. Shown on the workspace settings page. ${HUMAN_ONLY_NOTE}`,
    );

  positions
    .command('list')
    .description('List positions with their holders')
    .option(...WORKSPACE_OPTION)
    .option('--gaps', 'Also list members with no stated remit')
    .action(async (options: { workspace?: string; gaps?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const result = await client.positions.list(workspaceId);
        if (useJson) {
          console.log(JSON.stringify({ ...result, total: result.positions.length }, null, 2));
          return;
        }
        if (result.positions.length === 0) {
          console.log(chalk.gray('No positions yet. Add one with `exponential positions create`.'));
        } else {
          console.log(chalk.bold(`\nPositions (${result.positions.length})\n`));
          result.positions.forEach(printPosition);
        }
        if (options.gaps) {
          const gaps = result.members.filter((m) => m.remitGap);
          if (gaps.length === 0) {
            console.log(chalk.gray('Every member has a stated remit.'));
          } else {
            const roster = await client.workspaces.listMembers(workspaceId);
            const nameOf = (id: string) => {
              const member = roster.find((r) => r.id === id);
              return member?.name ?? member?.email ?? id;
            };
            console.log(chalk.bold(`No stated remit (${gaps.length}):`));
            gaps.forEach((g) => console.log(`  ${nameOf(g.userId)}`));
          }
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  positions
    .command('show <position>')
    .description('Show one position, by id or title')
    .option(...WORKSPACE_OPTION)
    .action(async (ref: string, options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const position = await loadPosition(client, workspaceId, ref);
        if (useJson) console.log(JSON.stringify(position, null, 2));
        else printPosition(position);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  positions
    .command('create')
    .description('Create a position')
    .requiredOption('-t, --title <title>', 'Title, 1–80 characters, unique in the workspace')
    .option('-r, --remit <markdown>', 'What its holders take on (Markdown, up to 2000 characters)')
    .option('--remit-file <path>', 'Read the remit from a file ("-" = stdin)')
    .option('-n, --not-accountable-for <markdown>', 'What it is explicitly not accountable for')
    .option('--not-accountable-for-file <path>', 'Read "not accountable for" from a file ("-" = stdin)')
    .option('--holder <member>', HOLDER_OPTION_DESCRIPTION, collectMention, [])
    .option(...WORKSPACE_OPTION)
    .action(
      async (
        options: {
          title: string;
          remit?: string;
          remitFile?: string;
          notAccountableFor?: string;
          notAccountableForFile?: string;
          holder: string[];
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const remit = readText(options.remit, options.remitFile);
          if (!remit?.trim()) throw new Error('A remit is required: pass --remit or --remit-file');
          const notAccountableFor = readText(options.notAccountableFor, options.notAccountableForFile);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const holderUserIds = options.holder.length
            ? resolveHolderIds(await client.workspaces.listMembers(workspaceId), options.holder)
            : undefined;
          const created = await client.positions.create({
            workspaceId,
            title: options.title,
            remit,
            ...(notAccountableFor !== undefined && { notAccountableFor }),
            ...(holderUserIds && { holderUserIds }),
          });
          output(created, useJson, 'Created');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  positions
    .command('update <position>')
    .description(`Edit a position, by id or title. --holder replaces the whole holder set.`)
    .option('-t, --title <title>', 'New title')
    .option('-r, --remit <markdown>', 'New remit')
    .option('--remit-file <path>', 'Read the new remit from a file ("-" = stdin)')
    .option('-n, --not-accountable-for <markdown>', 'New "not accountable for" ("" clears it)')
    .option('--not-accountable-for-file <path>', 'Read "not accountable for" from a file ("-" = stdin)')
    .option('--clear-not-accountable-for', 'Remove "not accountable for"')
    .option('--holder <member>', `${HOLDER_OPTION_DESCRIPTION}; replaces the current holders`, collectMention, [])
    .option('--no-holders', 'Remove every holder')
    .option(...WORKSPACE_OPTION)
    .action(
      async (
        ref: string,
        options: {
          title?: string;
          remit?: string;
          remitFile?: string;
          notAccountableFor?: string;
          notAccountableForFile?: string;
          clearNotAccountableFor?: boolean;
          holder: string[];
          holders: boolean;
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!options.holders && options.holder.length) {
            throw new Error('Pass either --holder or --no-holders, not both');
          }
          const remit = readText(options.remit, options.remitFile);
          const notAccountableFor = options.clearNotAccountableFor
            ? null
            : readText(options.notAccountableFor, options.notAccountableForFile);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const position = await loadPosition(client, workspaceId, ref);
          let holderUserIds: string[] | undefined;
          if (!options.holders) holderUserIds = [];
          else if (options.holder.length) {
            holderUserIds = resolveHolderIds(await client.workspaces.listMembers(workspaceId), options.holder);
          }
          const updated = await client.positions.update({
            workspaceId,
            positionId: position.id,
            ...(options.title !== undefined && { title: options.title }),
            ...(remit !== undefined && { remit }),
            ...(notAccountableFor !== undefined && { notAccountableFor }),
            ...(holderUserIds !== undefined && { holderUserIds }),
          });
          output(updated, useJson, 'Updated');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  positions
    .command('delete <position>')
    .description(`Delete a position, by id or title. Its holdings go with it.`)
    .option(...WORKSPACE_OPTION)
    .action(async (ref: string, options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const position = await loadPosition(client, workspaceId, ref);
        await client.positions.delete(workspaceId, position.id);
        if (useJson) console.log(JSON.stringify({ id: position.id, title: position.title, deleted: true }, null, 2));
        else console.log(chalk.green(`Deleted "${position.title}"`));
      } catch (error) {
        handleError(error, useJson);
      }
    });

  const holders = positions
    .command('holders')
    .description(`Change who holds a position (owner/admin).`);

  const holderAction =
    (mode: 'set' | 'add' | 'remove') =>
    async (ref: string, members: string[], options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const [position, roster] = await Promise.all([
          loadPosition(client, workspaceId, ref),
          client.workspaces.listMembers(workspaceId),
        ]);
        const named = resolveHolderIds(roster, members);
        const current = position.holders.map((h) => h.userId);
        const next =
          mode === 'set'
            ? named
            : mode === 'add'
              ? [...new Set([...current, ...named])]
              : current.filter((id) => !named.includes(id));
        const updated = await client.positions.setHolders(workspaceId, position.id, next);
        output(updated, useJson, 'Holders updated');
      } catch (error) {
        handleError(error, useJson);
      }
    };

  holders
    .command('set <position> [members...]')
    .description('Replace the holders (no members = nobody holds it)')
    .option(...WORKSPACE_OPTION)
    .action(holderAction('set'));
  holders
    .command('add <position> <members...>')
    .description('Add holders, by name, email or user id')
    .option(...WORKSPACE_OPTION)
    .action(holderAction('add'));
  holders
    .command('remove <position> <members...>')
    .description('Remove holders, by name, email or user id')
    .option(...WORKSPACE_OPTION)
    .action(holderAction('remove'));

  positions
    .command('import <file>')
    .description(
      'Create or update many positions from a JSON file ("-" = stdin): an array of ' +
        '{ title, remit, notAccountableFor?, holders?: [name|email|id] }. Matches existing positions ' +
        'by title (case-insensitive); an update replaces the remit and only adds holders. ' +
        'All or nothing.',
    )
    .option('--dry-run', 'Show what would change without writing')
    .option(...WORKSPACE_OPTION)
    .action(async (file: string, options: { dryRun?: boolean; workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const raw = readText(undefined, file)!;
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const roster = await client.workspaces.listMembers(workspaceId);
        const rows = parseImportFile(raw, roster);
        const result = await client.positions.importMany({
          workspaceId,
          dryRun: Boolean(options.dryRun),
          positions: rows,
        });
        if (useJson) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const nameOf = (id: string) => roster.find((r) => r.id === id)?.name ?? id;
        console.log(chalk.bold(result.written ? '\nImported:\n' : '\nDry run — nothing written:\n'));
        for (const row of result.results) {
          const tag = row.outcome === 'create' ? chalk.green('create') : chalk.yellow('update');
          console.log(`  ${tag} ${chalk.bold(row.title)} — ${row.holderUserIds.map(nameOf).join(', ') || 'no holders'}`);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return positions;
}

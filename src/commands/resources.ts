import { Command } from 'commander';
import type { ReadStatus } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputResourceJson,
  outputResourcePretty,
  outputResourcesJson,
  outputResourcesPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const STATUS_FILTERS = ['unread', 'to_read', 'reading', 'read', 'all'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function validateStatus(value: string | undefined): StatusFilter {
  const v = value ?? 'unread';
  if (!(STATUS_FILTERS as readonly string[]).includes(v)) {
    throw new Error(`Invalid --status "${value}". Valid: ${STATUS_FILTERS.join(', ')}`);
  }
  return v as StatusFilter;
}

/** Commander collector for a repeatable `--tag`; each value may also be comma-separated. */
export function collectTags(value: string, previous: string[]): string[] {
  const next = value.split(',').map((t) => t.trim()).filter(Boolean);
  return [...new Set([...previous, ...next])];
}

const TAG_OPTION = '--tag <tag>';

/**
 * Resources are saved external content (links, PDFs, pasted notes) — the
 * consumption side of Knowledge. The Reading list is the unread slice, so
 * `resources list` defaults to it and `resources create --url` files a link
 * to read later. Saved links are stored by title and URL only; nothing is
 * fetched or indexed for search.
 */
export function createResourcesCommand(): Command {
  const resources = new Command('resources').description(
    'Saved links and reference material. `list` defaults to the Reading list (unread); `create --url` saves a link to read later.',
  );

  resources
    .command('list')
    .description('List resources. Defaults to the Reading list (unread); --status read for what you finished, all for everything.')
    .option('--workspace <slug|id>', 'Workspace (defaults to the configured default)')
    .option('--status <status>', `One of: ${STATUS_FILTERS.join(', ')} (default: unread)`)
    .option('--search <text>', 'Filter by title/description')
    .option(TAG_OPTION, 'Only resources with this tag (repeatable or comma-separated; matches any)', collectTags, [])
    .option('--limit <n>', 'Max rows (default 50)', '50')
    .action(
      async (
        options: { workspace?: string; status?: string; search?: string; tag: string[]; limit: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateStatus(options.status);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const { resources: rows } = await client.resources.list({
            workspaceId,
            readStatus: status === 'all' ? undefined : status,
            search: options.search,
            tags: options.tag.length > 0 ? options.tag : undefined,
            limit: Number.parseInt(options.limit, 10) || 50,
          });
          if (useJson) outputResourcesJson(rows, { status, ...(options.tag.length > 0 && { tags: options.tag }) });
          else outputResourcesPretty(rows, status);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  resources
    .command('create')
    .description('Save a link to the Reading list (to read later). Stored by title and URL; not fetched or indexed.')
    .requiredOption('--url <url>', 'The http(s) link to save')
    .option('-t, --title <title>', 'Title (defaults to the hostname)')
    .option('--note <text>', 'One-line note (why, or who recommended it)')
    .option(
      TAG_OPTION,
      'Label it, e.g. where it came from (repeatable or comma-separated; added to any tags a re-saved link has)',
      collectTags,
      [],
    )
    .option('--workspace <slug|id>', 'Workspace (defaults to the configured default)')
    .option('--read', 'Save as already read (reference material, not a queue item)')
    .action(
      async (
        options: { url: string; title?: string; note?: string; tag: string[]; workspace?: string; read?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const resource = await client.resources.save({
            url: options.url,
            title: options.title,
            note: options.note,
            tags: options.tag.length > 0 ? options.tag : undefined,
            workspaceId,
            readStatus: options.read ? 'read' : 'to_read',
          });
          if (useJson) outputResourceJson(resource);
          else {
            console.log('\n✓ Saved to Reading list');
            outputResourcePretty(resource);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  resources
    .command('tag <id>')
    .description("Add or remove a resource's tags")
    .option('--add <tag>', 'Tag to add (repeatable or comma-separated)', collectTags, [])
    .option('--remove <tag>', 'Tag to remove (repeatable or comma-separated)', collectTags, [])
    .action(async (id: string, options: { add: string[]; remove: string[] }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        if (options.add.length === 0 && options.remove.length === 0) {
          throw new Error('Pass --add <tag> and/or --remove <tag>');
        }
        const client = getClient();
        const current = await client.resources.get(id);
        const kept = (current.tags ?? []).filter((t) => !options.remove.includes(t));
        const tags = [...new Set([...kept, ...options.add])];
        const resource = await client.resources.update(id, { tags });
        if (useJson) outputResourceJson(resource);
        else {
          console.log(`\n✓ Tags updated`);
          outputResourcePretty(resource);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  const setStatus = (name: string, readStatus: ReadStatus, description: string) =>
    resources
      .command(`${name} <id>`)
      .description(description)
      .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const result = await client.resources.setReadStatus(id, readStatus);
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else console.log(`✓ ${id} is now ${result.readStatus}`);
        } catch (error) {
          handleError(error, useJson);
        }
      });

  setStatus('mark-read', 'read', 'Mark a saved resource as read (records when; fetches nothing)');
  setStatus('unread', 'to_read', 'Put a resource back on the Reading list');

  resources
    .command('archive <id>')
    .description('Archive a resource: out of every list, but kept')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const result = await client.resources.archive(id);
        if (useJson) console.log(JSON.stringify({ id, ...result }, null, 2));
        else console.log(`✓ Archived ${id}`);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return resources;
}

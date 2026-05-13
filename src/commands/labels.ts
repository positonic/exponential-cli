import { Command } from 'commander';
import chalk from 'chalk';
import type { Tag } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import { shouldUseJson } from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

interface SeedLabel {
  name: string;
  slug: string;
  color: string;
}

/**
 * Canonical triage labels referenced by the `/triage` agent skill. Slugs are
 * deterministic, so re-running `seed-triage` after a partial creation only
 * creates the missing ones.
 */
const TRIAGE_LABELS: SeedLabel[] = [
  { slug: 'needs-triage', name: 'needs-triage', color: 'avatar-orange' },
  { slug: 'needs-info', name: 'needs-info', color: 'avatar-yellow' },
  { slug: 'ready-for-agent', name: 'ready-for-agent', color: 'avatar-green' },
  { slug: 'ready-for-human', name: 'ready-for-human', color: 'avatar-lightBlue' },
  { slug: 'wontfix', name: 'wontfix', color: 'avatar-lightGray' },
];

const CUID_PATTERN = /^c[a-z0-9]{20,}$/i;

function looksLikeCuid(value: string): boolean {
  return CUID_PATTERN.test(value);
}

function outputTagsPretty(tags: Tag[]): void {
  if (tags.length === 0) {
    console.log(chalk.dim('No labels found.'));
    return;
  }
  console.log();
  for (const tag of tags) {
    const scope = tag.workspaceId === null ? chalk.cyan('global') : chalk.magenta('workspace');
    const category = tag.category === null ? chalk.dim('(label)') : chalk.dim(`(${tag.category})`);
    console.log(
      `  ${chalk.bold(tag.slug)}  ${tag.name}  ${chalk.gray(tag.color)}  ${scope}  ${category}`,
    );
  }
  console.log();
}

function outputTagPretty(tag: Tag, prefix?: string): void {
  if (prefix) console.log(prefix);
  console.log(`  ${chalk.bold(tag.slug)}  ${tag.name}  ${chalk.gray(tag.color)}`);
}

export async function resolveLabelIds(
  client: ReturnType<typeof getClient>,
  workspaceId: string | undefined,
  values: string[],
): Promise<string[]> {
  if (values.length === 0) return [];

  const bySlug = values.filter((v) => !looksLikeCuid(v));
  const byId = values.filter((v) => looksLikeCuid(v));

  if (bySlug.length === 0) return byId;

  const list = await client.labels.list({ workspaceId });
  const slugMap = new Map(list.allTags.map((t) => [t.slug, t.id]));

  const resolvedFromSlugs: string[] = [];
  const missing: string[] = [];
  for (const slug of bySlug) {
    const id = slugMap.get(slug);
    if (id === undefined) missing.push(slug);
    else resolvedFromSlugs.push(id);
  }
  if (missing.length > 0) {
    throw new Error(
      `Unknown label slug(s): ${missing.join(', ')}. Run \`exponential labels list --workspace <slug>\` to see available labels.`,
    );
  }
  return [...byId, ...resolvedFromSlugs];
}

export function createLabelsCommand(): Command {
  const labels = new Command('labels').description(
    'Manage labels (orthogonal tags applied to actions, tickets, features, and epics).',
  );

  labels
    .command('list')
    .description('List labels visible in a workspace')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .option(
      '--category <category>',
      'Filter by category. Use "label" for general labels, "null" for category-less labels, or omit to list all.',
    )
    .action(
      async (
        options: { workspace?: string; category?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const category =
            options.category === undefined
              ? undefined
              : options.category === 'null'
                ? null
                : options.category;
          const result = await client.labels.list({ workspaceId, category });
          if (useJson) {
            console.log(JSON.stringify(result.allTags, null, 2));
          } else {
            outputTagsPretty(result.allTags);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  labels
    .command('create')
    .description('Create a workspace-scoped label')
    .requiredOption('-n, --name <name>', 'Label name')
    .requiredOption('--color <token>', 'Color token (e.g. avatar-green, brand-primary)')
    .option('-d, --description <text>', 'Description')
    .option('--category <category>', 'Category. Omit (or pass "null") to create a general label.')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .action(
      async (
        options: {
          name: string;
          color: string;
          description?: string;
          category?: string;
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          if (workspaceId === undefined) {
            throw new Error(
              'Workspace is required. Pass --workspace <slug|id> or set a default with `exponential workspaces set-default`.',
            );
          }
          const category =
            options.category === undefined
              ? undefined
              : options.category === 'null'
                ? null
                : options.category;
          const tag = await client.labels.create({
            workspaceId,
            name: options.name,
            color: options.color,
            description: options.description,
            category,
          });
          if (useJson) {
            console.log(JSON.stringify(tag, null, 2));
          } else {
            outputTagPretty(tag, chalk.green('\n✓ Label created'));
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  labels
    .command('seed-triage')
    .description('Idempotently seed the five canonical triage labels into a workspace.')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .action(
      async (options: { workspace?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          if (workspaceId === undefined) {
            throw new Error(
              'Workspace is required. Pass --workspace <slug|id> or set a default with `exponential workspaces set-default`.',
            );
          }
          const existing = await client.labels.list({ workspaceId });
          const existingSlugs = new Set(existing.allTags.map((t) => t.slug));

          const results: Array<{
            slug: string;
            status: 'created' | 'existed';
            tag?: Tag;
          }> = [];
          for (const def of TRIAGE_LABELS) {
            if (existingSlugs.has(def.slug)) {
              results.push({ slug: def.slug, status: 'existed' });
              continue;
            }
            const tag = await client.labels.create({
              workspaceId,
              name: def.name,
              color: def.color,
            });
            results.push({ slug: def.slug, status: 'created', tag });
          }

          if (useJson) {
            console.log(JSON.stringify(results, null, 2));
          } else {
            console.log();
            console.log(chalk.bold('Triage labels:'));
            for (const r of results) {
              const tag = chalk.bold(r.slug);
              const status =
                r.status === 'created'
                  ? chalk.green('created')
                  : chalk.dim('existed');
              console.log(`  ${tag}  ${status}`);
            }
            console.log();
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  return labels;
}

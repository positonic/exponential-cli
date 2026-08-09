import { Command } from 'commander';
import type { FeatureStatus, Ticket } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveProductId, resolveWorkspaceId } from '../utils/resolve.js';
import { createStoriesCommand } from './stories.js';
import { createScopesCommand } from './scopes.js';
import { createRequirementsCommand } from './requirements.js';
import { createAreasCommand } from './areas.js';
import { createFeatureCommentsCommand } from './featureComments.js';
import {
  shouldUseJson,
  outputFeaturesJson,
  outputFeaturesPretty,
  outputFeatureJson,
  outputFeaturePretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const FEATURE_STATUSES: FeatureStatus[] = [
  'IDEA',
  'DEFINED',
  'IN_PROGRESS',
  'SHIPPED',
  'DEPRECATED',
  'ARCHIVED',
];

interface TicketSummary {
  id: string;
  shortId: string | null;
  number: number | null;
  title: string;
}

function summarizeTicket(ticket: Ticket): TicketSummary {
  return {
    id: ticket.id,
    shortId: ticket.shortId ?? null,
    number: ticket.number ?? null,
    title: ticket.title,
  };
}

function ticketLabel(ticket: Ticket): string {
  return ticket.shortId ?? (ticket.number != null ? `#${ticket.number}` : ticket.id);
}

/**
 * `--goal` takes an objective's integer id, or "none" to unlink. Objectives are
 * the only entity here keyed by an integer rather than a cuid.
 */
function parseFeatureGoalId(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'none') return null;
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new Error(
      `--goal must be a whole number or "none", got "${value}". Find one with \`exponential goals list\`.`,
    );
  }
  return id;
}

function validateFeatureStatus(value: string | undefined): FeatureStatus | undefined {
  if (!value) return undefined;
  if (!(FEATURE_STATUSES as string[]).includes(value)) {
    throw new Error(
      `Invalid status "${value}". Valid: ${FEATURE_STATUSES.join(', ')}`,
    );
  }
  return value as FeatureStatus;
}

export function createFeaturesCommand(): Command {
  const features = new Command('features').description(
    'Manage features. A feature lives under a product and groups user stories, scopes, and tickets.',
  );

  features
    .command('list')
    .description('List features in a product')
    .requiredOption('--product <slug|id>', 'Product slug or CUID')
    .option('--workspace <slug|id>', 'Workspace (required when --product is a slug)')
    .option('--status <status>', `Filter by status: ${FEATURE_STATUSES.join(', ')}`)
    .action(
      async (
        options: { product: string; workspace?: string; status?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateFeatureStatus(options.status);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId = await resolveProductId(
            client,
            workspaceId,
            options.product,
          );
          const list = await client.features.list({ productId, status });
          if (useJson) outputFeaturesJson(list);
          else outputFeaturesPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  features
    .command('get <id>')
    .description('Get a feature by CUID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const feature = await client.features.get(id);
        if (useJson) outputFeatureJson(feature);
        else outputFeaturePretty(feature);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  features
    .command('create')
    .description('Create a new feature in a product')
    .requiredOption('--product <slug|id>', 'Product slug or CUID')
    .requiredOption('-n, --name <name>', 'Feature name')
    .option('-d, --description <text>', 'Description (markdown supported)')
    .option('--vision <text>', 'Vision / target outcome')
    .option('--status <status>', `Status: ${FEATURE_STATUSES.join(', ')}`)
    .option('--priority <n>', 'Priority 0-4 (lower = higher)', parseInt)
    .option('--effort <n>', 'Effort estimate', parseFloat)
    .option('--area <id>', 'Area CUID (per-product bucket) to file the feature under')
    .option('--workspace <slug|id>', 'Workspace (required when --product is a slug)')
    .action(
      async (
        options: {
          product: string;
          name: string;
          description?: string;
          vision?: string;
          status?: string;
          priority?: number;
          effort?: number;
          area?: string;
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateFeatureStatus(options.status);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId = await resolveProductId(
            client,
            workspaceId,
            options.product,
          );
          const feature = await client.features.create({
            productId,
            name: options.name,
            description: options.description,
            vision: options.vision,
            status,
            priority: options.priority,
            effort: options.effort,
            areaId: options.area,
          });
          if (useJson) outputFeatureJson(feature);
          else {
            console.log('\n✓ Feature created');
            outputFeaturePretty(feature);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  features
    .command('update')
    .description('Update an existing feature')
    .requiredOption('--id <id>', 'Feature CUID')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <text>', 'New description')
    .option('--vision <text>', 'New vision text')
    .option('--status <status>', `Status: ${FEATURE_STATUSES.join(', ')}`)
    .option('--priority <n>', 'Priority 0-4', parseInt)
    .option('--effort <n>', 'Effort estimate', parseFloat)
    .option('--area <id>', 'Area CUID ("none" to clear)')
    .option(
      '--goal <id|none>',
      'Objective (goal) id this feature serves ("none" to clear). For progress ' +
        'rollup, link the finer Feature→key-result edge with `goals kr link --feature`.',
    )
    .action(
      async (
        options: {
          id: string;
          name?: string;
          description?: string;
          vision?: string;
          status?: string;
          priority?: number;
          effort?: number;
          area?: string;
          goal?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateFeatureStatus(options.status);
          const client = getClient();
          const feature = await client.features.update({
            id: options.id,
            name: options.name,
            description: options.description,
            vision: options.vision,
            status,
            priority: options.priority,
            effort: options.effort,
            areaId: options.area === 'none' ? null : options.area,
            goalId: parseFeatureGoalId(options.goal),
          });
          if (useJson) outputFeatureJson(feature);
          else {
            console.log('\n✓ Feature updated');
            outputFeaturePretty(feature);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  features
    .command('delete <id>')
    .description(
      "Delete a feature. Refuses if it still has tickets — deleting a feature does not " +
        'delete its tickets, it unlinks them (Ticket.featureId is SetNull), silently ' +
        'orphaning them in the product backlog.',
    )
    .option(
      '--with-tickets',
      "Delete the feature's tickets first, then the feature (destructive)",
    )
    .option(
      '--orphan-tickets',
      'Delete the feature anyway, leaving its tickets in the backlog unlinked',
    )
    .action(
      async (
        id: string,
        options: { withTickets?: boolean; orphanTickets?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (options.withTickets && options.orphanTickets) {
            throw new Error(
              '--with-tickets and --orphan-tickets are mutually exclusive',
            );
          }
          const client = getClient();
          const feature = await client.features.get(id);

          // `features get` returns `_count.tickets`; trust a zero count and skip
          // the extra round trip. Otherwise fetch the tickets themselves — they
          // are needed both to report and (with --with-tickets) to delete.
          const tickets =
            feature._count?.tickets === 0
              ? []
              : await client.tickets.list({
                  productId: feature.productId,
                  featureId: feature.id,
                });

          if (tickets.length > 0 && !options.withTickets && !options.orphanTickets) {
            const reason = `has ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;
            if (useJson) {
              console.log(
                JSON.stringify(
                  {
                    deleted: false,
                    id: feature.id,
                    reason,
                    tickets: tickets.map(summarizeTicket),
                  },
                  null,
                  2,
                ),
              );
            } else {
              console.error(
                `\nRefusing to delete "${feature.name}": it ${reason}.\n` +
                  'Deleting the feature would leave them unlinked in the product backlog.\n' +
                  '  --with-tickets    delete those tickets first, then the feature\n' +
                  '  --orphan-tickets  delete the feature anyway and unlink them',
              );
              for (const t of tickets) {
                console.error(`  - ${ticketLabel(t)} ${t.title}`);
              }
            }
            process.exitCode = 1;
            return;
          }

          const ticketsDeleted: TicketSummary[] = [];
          const ticketsFailed: (TicketSummary & { error: string })[] = [];
          if (options.withTickets) {
            for (const ticket of tickets) {
              try {
                await client.tickets.delete(ticket.id);
                ticketsDeleted.push(summarizeTicket(ticket));
              } catch (error) {
                ticketsFailed.push({
                  ...summarizeTicket(ticket),
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }

          // Never delete the feature after a partial ticket sweep — the survivors
          // would be orphaned, which is exactly what --with-tickets promises to avoid.
          if (ticketsFailed.length > 0) {
            const reason = `failed to delete ${ticketsFailed.length} of ${tickets.length} tickets`;
            if (useJson) {
              console.log(
                JSON.stringify(
                  { deleted: false, id: feature.id, reason, ticketsDeleted, ticketsFailed },
                  null,
                  2,
                ),
              );
            } else {
              console.error(`\nAborted: ${reason}. Feature "${feature.name}" was NOT deleted.`);
              for (const t of ticketsFailed) {
                console.error(`  - ${t.shortId ?? t.id}: ${t.error}`);
              }
            }
            process.exitCode = 1;
            return;
          }

          await client.features.delete(feature.id);

          const ticketsOrphaned = options.orphanTickets
            ? tickets.map(summarizeTicket)
            : [];

          if (useJson) {
            console.log(
              JSON.stringify(
                { deleted: true, id: feature.id, ticketsDeleted, ticketsOrphaned },
                null,
                2,
              ),
            );
          } else {
            console.log('\n✓ Feature deleted');
            if (ticketsDeleted.length > 0) {
              console.log(`  ${ticketsDeleted.length} ticket(s) deleted with it`);
            }
            if (ticketsOrphaned.length > 0) {
              console.log(`  ${ticketsOrphaned.length} ticket(s) left unlinked in the backlog`);
            }
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  features
    .command('link-page')
    .description('Link a Knowledge page (PRD, spec, research) to a feature')
    .requiredOption('--feature <id>', 'Feature CUID')
    .requiredOption('--page <id>', 'Page CUID')
    .option('--scope <id>', 'Feature scope CUID to pin the page to')
    .action(
      async (
        options: { feature: string; page: string; scope?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const link = await client.features.linkPage({
            featureId: options.feature,
            pageId: options.page,
            scopeId: options.scope,
          });
          if (useJson) console.log(JSON.stringify(link, null, 2));
          else console.log('\n✓ Page linked');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  features
    .command('unlink-page')
    .description('Unlink a Knowledge page from a feature')
    .requiredOption('--feature <id>', 'Feature CUID')
    .requiredOption('--page <id>', 'Page CUID')
    .action(
      async (options: { feature: string; page: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const result = await client.features.unlinkPage(
            options.feature,
            options.page,
          );
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else console.log('\n✓ Page unlinked');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  features.addCommand(createStoriesCommand());
  features.addCommand(createScopesCommand());
  features.addCommand(createRequirementsCommand());
  features.addCommand(createAreasCommand());
  features.addCommand(createFeatureCommentsCommand());

  return features;
}

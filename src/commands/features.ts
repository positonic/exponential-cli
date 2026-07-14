import { Command } from 'commander';
import type { FeatureStatus } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveProductId, resolveWorkspaceId } from '../utils/resolve.js';
import { createStoriesCommand } from './stories.js';
import { createScopesCommand } from './scopes.js';
import { createRequirementsCommand } from './requirements.js';
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

  return features;
}

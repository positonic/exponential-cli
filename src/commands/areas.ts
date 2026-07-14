import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveProductId, resolveWorkspaceId } from '../utils/resolve.js';
import { shouldUseJson } from '../utils/output.js';
import chalk from 'chalk';
import type { Area } from 'exponential-sdk';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

function outputAreasPretty(areas: Area[]): void {
  if (areas.length === 0) {
    console.log(chalk.gray('No areas found.'));
    return;
  }
  console.log(chalk.bold(`\nAreas (${areas.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const a of areas) {
    const count = a._count?.features != null ? chalk.gray(` (${a._count.features} features)`) : '';
    console.log(`  ${chalk.bold(a.name)}${count}`);
    console.log(chalk.gray(`    ID: ${a.id}`));
  }
  console.log();
}

export function createAreasCommand(): Command {
  const areas = new Command('areas').description(
    'Manage a product\'s areas: the buckets features are filed under (a feature has exactly one or none).',
  );

  areas
    .command('list')
    .description('List a product\'s areas')
    .requiredOption('--product <slug|id>', 'Product slug or CUID')
    .option('--workspace <slug|id>', 'Workspace (required when --product is a slug)')
    .action(
      async (options: { product: string; workspace?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId = await resolveProductId(client, workspaceId, options.product);
          const list = await client.areas.list({ productId });
          if (useJson) console.log(JSON.stringify({ areas: list, total: list.length }, null, 2));
          else outputAreasPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  areas
    .command('create')
    .description('Create an area in a product')
    .requiredOption('--product <slug|id>', 'Product slug or CUID')
    .requiredOption('-n, --name <name>', 'Area name (unique per product)')
    .option('-d, --description <text>', 'What belongs in this area')
    .option('--workspace <slug|id>', 'Workspace (required when --product is a slug)')
    .action(
      async (
        options: { product: string; name: string; description?: string; workspace?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId = await resolveProductId(client, workspaceId, options.product);
          const area = await client.areas.create({
            productId,
            name: options.name,
            description: options.description,
          });
          if (useJson) console.log(JSON.stringify(area, null, 2));
          else console.log(`\n✓ Area created: ${area.name} (${area.id})`);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  return areas;
}

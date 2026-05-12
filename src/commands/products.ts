import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputProductsJson,
  outputProductsPretty,
  outputProductJson,
  outputProductPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

export function createProductsCommand(): Command {
  const products = new Command('products').description(
    'Manage products. A workspace contains products; a product holds features and tickets.',
  );

  products
    .command('list')
    .description('List products in a workspace')
    .option('--workspace <slug|id>', 'Workspace slug or CUID (defaults to configured workspace)')
    .action(async (options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const list = await client.products.list(workspaceId);
        if (useJson) outputProductsJson(list);
        else outputProductsPretty(list);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  products
    .command('get <slugOrId>')
    .description('Get a product by slug or CUID')
    .option('--workspace <slug|id>', 'Workspace (required when using a slug)')
    .action(async (slugOrId: string, options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const product = await client.products.resolve(workspaceId, slugOrId);
        if (useJson) outputProductJson(product);
        else outputProductPretty(product);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  products
    .command('create')
    .description('Create a new product')
    .requiredOption('-n, --name <name>', 'Product name')
    .requiredOption('--slug <slug>', 'Kebab-case slug (matches /^[a-z0-9-]+$/)')
    .option('-d, --description <text>', 'Description')
    .option('--icon <icon>', 'Icon shortcode')
    .option('--color <color>', 'Color')
    .option('--workspace <slug|id>', 'Workspace slug or CUID')
    .action(
      async (
        options: {
          name: string;
          slug: string;
          description?: string;
          icon?: string;
          color?: string;
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!/^[a-z0-9-]+$/.test(options.slug)) {
            throw new Error(
              `Invalid slug "${options.slug}". Slug must be kebab-case (a-z, 0-9, -).`,
            );
          }
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const product = await client.products.create({
            workspaceId,
            name: options.name,
            slug: options.slug,
            description: options.description,
            icon: options.icon,
            color: options.color,
          });
          if (useJson) outputProductJson(product);
          else {
            console.log('\n✓ Product created');
            outputProductPretty(product);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  return products;
}

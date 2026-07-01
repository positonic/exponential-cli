import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputOrganizationJson,
  outputOrganizationPretty,
  outputOrganizationsJson,
  outputOrganizationsPretty,
} from '../utils/output.js';
import type { OrganizationSize } from 'exponential-sdk';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
  workspace?: string;
}

const VALID_SIZES: OrganizationSize[] = [
  '1-10', '11-50', '51-200', '201-500', '501-1000', '1000+',
];

export function createOrganizationsCommand(): Command {
  const organizations = new Command('organizations')
    .alias('orgs')
    .description('Manage CRM organizations');

  organizations
    .command('list')
    .description('List organizations')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .option('--search <query>', 'Search by name or description')
    .option('--industry <industry>', 'Filter by industry')
    .option('--limit <n>', 'Max results to return', parseInt)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (options: {
      workspace: string;
      search?: string;
      industry?: string;
      limit?: number;
      cursor?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const result = await client.organizations.list({
          workspaceId: options.workspace,
          search: options.search,
          industry: options.industry,
          limit: options.limit,
          cursor: options.cursor,
        });

        if (useJson) {
          outputOrganizationsJson(result.organizations, result.nextCursor);
        } else {
          outputOrganizationsPretty(result.organizations);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  organizations
    .command('get')
    .description('Get an organization by ID')
    .argument('<id>', 'Organization ID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const org = await client.organizations.get(id);

        if (useJson) {
          outputOrganizationJson(org);
        } else {
          outputOrganizationPretty(org);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  organizations
    .command('create')
    .description('Create a new organization')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--name <name>', 'Organization name')
    .option('--website-url <url>', 'Website URL')
    .option('--logo-url <url>', 'Logo URL')
    .option('--description <text>', 'Description')
    .option('--industry <industry>', 'Industry')
    .option('--size <size>', `Company size (${VALID_SIZES.join(', ')})`)
    .action(async (options: {
      workspace: string;
      name: string;
      websiteUrl?: string;
      logoUrl?: string;
      description?: string;
      industry?: string;
      size?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        if (options.size && !VALID_SIZES.includes(options.size as OrganizationSize)) {
          throw new Error(`Invalid size "${options.size}". Valid: ${VALID_SIZES.join(', ')}`);
        }

        const client = getClient();
        const org = await client.organizations.create({
          workspaceId: options.workspace,
          name: options.name,
          websiteUrl: options.websiteUrl,
          logoUrl: options.logoUrl,
          description: options.description,
          industry: options.industry,
          size: options.size as OrganizationSize | undefined,
        });

        if (useJson) {
          outputOrganizationJson(org);
        } else {
          console.log('\n✓ Organization created successfully');
          outputOrganizationPretty(org);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return organizations;
}

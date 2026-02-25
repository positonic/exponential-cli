import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputDealJson,
  outputDealPretty,
  outputDealsJson,
  outputDealsPretty,
  outputPipelineJson,
  outputPipelinePretty,
  outputStagesJson,
  outputStagesPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
  workspace?: string;
}

export function createDealsCommand(): Command {
  const deals = new Command('deals')
    .description('Manage pipeline deals');

  deals
    .command('pipeline')
    .description('Get pipeline overview with stages')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .action(async (options: { workspace: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const pipeline = await client.pipelines.get(options.workspace);

        if (!pipeline) {
          if (useJson) {
            console.log(JSON.stringify({ pipeline: null }, null, 2));
          } else {
            console.log('No pipeline found for this workspace. One will be created when you add your first deal.');
          }
          return;
        }

        if (useJson) {
          outputPipelineJson(pipeline);
        } else {
          outputPipelinePretty(pipeline);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  deals
    .command('stages')
    .description('List pipeline stages')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .action(async (options: { workspace: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const stages = await client.pipelines.getStages(options.workspace);

        if (useJson) {
          outputStagesJson(stages);
        } else {
          outputStagesPretty(stages);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  deals
    .command('list')
    .description('List all deals')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .action(async (options: { workspace: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const dealsList = await client.pipelines.listDeals(options.workspace);

        if (useJson) {
          outputDealsJson(dealsList);
        } else {
          outputDealsPretty(dealsList);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  deals
    .command('get')
    .description('Get a deal by ID')
    .argument('<id>', 'Deal ID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const deal = await client.pipelines.getDeal(id);

        if (useJson) {
          outputDealJson(deal);
        } else {
          outputDealPretty(deal);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  deals
    .command('create')
    .description('Create a new deal')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--stage <id>', 'Pipeline stage ID')
    .requiredOption('--title <title>', 'Deal title')
    .option('--description <text>', 'Deal description')
    .option('--value <amount>', 'Deal value', parseFloat)
    .option('--currency <code>', 'Currency code (default: USD)')
    .option('--probability <pct>', 'Win probability (0-100)', parseInt)
    .option('--close-date <date>', 'Expected close date (YYYY-MM-DD)')
    .option('--contact <id>', 'Contact ID')
    .option('--organization <id>', 'Organization ID')
    .option('--assigned-to <id>', 'Assigned user ID')
    .action(async (options: {
      workspace: string;
      stage: string;
      title: string;
      description?: string;
      value?: number;
      currency?: string;
      probability?: number;
      closeDate?: string;
      contact?: string;
      organization?: string;
      assignedTo?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        let expectedCloseDate: Date | undefined;
        if (options.closeDate) {
          expectedCloseDate = new Date(options.closeDate);
          if (isNaN(expectedCloseDate.getTime())) {
            throw new Error('Invalid close date format. Use YYYY-MM-DD');
          }
        }

        const client = getClient();
        const deal = await client.pipelines.createDeal({
          workspaceId: options.workspace,
          stageId: options.stage,
          title: options.title,
          description: options.description,
          value: options.value,
          currency: options.currency,
          probability: options.probability,
          expectedCloseDate,
          contactId: options.contact,
          organizationId: options.organization,
          assignedToId: options.assignedTo,
        });

        if (useJson) {
          outputDealJson(deal);
        } else {
          console.log('\n✓ Deal created successfully');
          outputDealPretty(deal);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  deals
    .command('update')
    .description('Update an existing deal')
    .requiredOption('--id <id>', 'Deal ID')
    .option('--title <title>', 'Deal title')
    .option('--description <text>', 'Description (use "null" to clear)')
    .option('--value <amount>', 'Deal value (use "null" to clear)')
    .option('--currency <code>', 'Currency code')
    .option('--probability <pct>', 'Win probability (use "null" to clear)')
    .option('--close-date <date>', 'Expected close date (YYYY-MM-DD or "null" to clear)')
    .option('--contact <id>', 'Contact ID (use "null" to clear)')
    .option('--organization <id>', 'Organization ID (use "null" to clear)')
    .option('--assigned-to <id>', 'Assigned user ID (use "null" to clear)')
    .action(async (options: {
      id: string;
      title?: string;
      description?: string;
      value?: string;
      currency?: string;
      probability?: string;
      closeDate?: string;
      contact?: string;
      organization?: string;
      assignedTo?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      const nullable = <T>(v: string | undefined, parse?: (s: string) => T): T | null | undefined => {
        if (v === undefined) return undefined;
        if (v === 'null') return null;
        return parse ? parse(v) : v as unknown as T;
      };

      try {
        let expectedCloseDate: Date | null | undefined;
        if (options.closeDate === 'null') {
          expectedCloseDate = null;
        } else if (options.closeDate) {
          expectedCloseDate = new Date(options.closeDate);
          if (isNaN(expectedCloseDate.getTime())) {
            throw new Error('Invalid close date format. Use YYYY-MM-DD');
          }
        }

        const client = getClient();
        const deal = await client.pipelines.updateDeal({
          id: options.id,
          title: options.title,
          description: nullable(options.description),
          value: nullable(options.value, parseFloat),
          currency: options.currency,
          probability: nullable(options.probability, parseInt),
          expectedCloseDate,
          contactId: nullable(options.contact),
          organizationId: nullable(options.organization),
          assignedToId: nullable(options.assignedTo),
        });

        if (useJson) {
          outputDealJson(deal);
        } else {
          console.log('\n✓ Deal updated successfully');
          outputDealPretty(deal);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  deals
    .command('move')
    .description('Move a deal to a different stage')
    .requiredOption('--id <id>', 'Deal ID')
    .requiredOption('--stage <id>', 'Target stage ID')
    .option('--order <n>', 'Position within stage', parseInt, 0)
    .action(async (options: { id: string; stage: string; order: number }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const deal = await client.pipelines.moveDeal({
          id: options.id,
          stageId: options.stage,
          stageOrder: options.order,
        });

        if (useJson) {
          outputDealJson(deal);
        } else {
          console.log('\n✓ Deal moved successfully');
          outputDealPretty(deal);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  deals
    .command('delete')
    .description('Delete a deal')
    .argument('<id>', 'Deal ID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        await client.pipelines.deleteDeal(id);

        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id }, null, 2));
        } else {
          console.log(`\n✓ Deal ${id} deleted`);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return deals;
}

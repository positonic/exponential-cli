import { Command } from 'commander';
import type { FeatureScopeStatus } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputScopeJson,
  outputScopePretty,
  outputScopesJson,
  outputScopesPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const SCOPE_STATUSES: FeatureScopeStatus[] = [
  'PLANNED',
  'IN_PROGRESS',
  'SHIPPED',
  'DEPRECATED',
];

function validateScopeStatus(value: string | undefined): FeatureScopeStatus | undefined {
  if (!value) return undefined;
  if (!(SCOPE_STATUSES as string[]).includes(value)) {
    throw new Error(
      `Invalid status "${value}". Valid: ${SCOPE_STATUSES.join(', ')}`,
    );
  }
  return value as FeatureScopeStatus;
}

export function createScopesCommand(): Command {
  const scopes = new Command('scopes').description(
    'Manage a feature\'s scopes: shippable increments ("V1", "V2"), each with its own lifecycle.',
  );

  scopes
    .command('list')
    .description('List a feature\'s scopes')
    .requiredOption('--feature <id>', 'Feature CUID')
    .action(
      async (options: { feature: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const list = await client.scopes.list({ featureId: options.feature });
          if (useJson) outputScopesJson(list);
          else outputScopesPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  scopes
    .command('add')
    .description('Add a scope to a feature')
    .requiredOption('--feature <id>', 'Feature CUID')
    .requiredOption('--version <label>', 'Short label for the increment, e.g. "V1"')
    .requiredOption('-d, --description <text>', 'What this scope delivers (markdown supported)')
    .option('--status <status>', `Status: ${SCOPE_STATUSES.join(', ')} (default PLANNED)`)
    .action(
      async (
        options: { feature: string; version: string; description: string; status?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateScopeStatus(options.status);
          const client = getClient();
          const scope = await client.scopes.create({
            featureId: options.feature,
            version: options.version,
            description: options.description,
            status,
          });
          if (useJson) outputScopeJson(scope);
          else {
            console.log('\n✓ Scope added');
            outputScopePretty(scope);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  scopes
    .command('update')
    .description('Update a scope (setting SHIPPED stamps shippedAt and rolls the feature status up)')
    .requiredOption('--id <id>', 'Scope CUID')
    .option('--version <label>', 'New version label')
    .option('-d, --description <text>', 'New description')
    .option('--status <status>', `Status: ${SCOPE_STATUSES.join(', ')}`)
    .action(
      async (
        options: { id: string; version?: string; description?: string; status?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateScopeStatus(options.status);
          const client = getClient();
          const scope = await client.scopes.update({
            id: options.id,
            version: options.version,
            description: options.description,
            status,
          });
          if (useJson) outputScopeJson(scope);
          else {
            console.log('\n✓ Scope updated');
            outputScopePretty(scope);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  scopes
    .command('rm')
    .description('Delete a scope')
    .requiredOption('--id <id>', 'Scope CUID')
    .action(async (options: { id: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const result = await client.scopes.delete(options.id);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log('\n✓ Scope deleted');
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return scopes;
}

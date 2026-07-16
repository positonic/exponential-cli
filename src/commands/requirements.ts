import { Command } from 'commander';
import type { RequirementCreateInput, RequirementKind } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputRequirementJson,
  outputRequirementPretty,
  outputRequirementsJson,
  outputRequirementsPretty,
  outputRequirementBatchJson,
  outputRequirementBatchPretty,
  type BatchRequirementResult,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const REQUIREMENT_KINDS: RequirementKind[] = [
  'FUNCTIONAL',
  'NON_FUNCTIONAL',
  'CONSTRAINT',
];

function validateKind(value: string | undefined): RequirementKind | undefined {
  if (!value) return undefined;
  if (!(REQUIREMENT_KINDS as string[]).includes(value)) {
    throw new Error(
      `Invalid kind "${value}". Valid: ${REQUIREMENT_KINDS.join(', ')}`,
    );
  }
  return value as RequirementKind;
}

// Shape of a single requirement object in the stdin batch array.
interface BatchRequirementInput {
  statement: string;
  kind?: RequirementKind;
  scopeId?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export function createRequirementsCommand(): Command {
  const requirements = new Command('requirements').description(
    'Manage a feature\'s requirements: atomic, testable EARS-style "shall" statements, checkable met/unmet.',
  );

  requirements
    .command('add')
    .description(
      [
        'Add requirements to a feature.',
        '',
        'Flag mode: pass -s/--statement (plus optional --kind/--scope) to add one requirement.',
        'Batch mode: pipe a JSON array of { statement, kind?, scopeId? } on stdin',
        '            to add many at once (per-item success/failure is reported).',
      ].join('\n'),
    )
    .requiredOption('--feature <id>', 'Feature CUID')
    .option('-s, --statement <text>', 'One EARS-style "shall" statement')
    .option('--kind <kind>', `Kind: ${REQUIREMENT_KINDS.join(', ')}`)
    .option('--scope <id>', 'Feature scope CUID to pin the requirement to')
    .action(
      async (
        options: { feature: string; statement?: string; kind?: string; scope?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();

          if (options.statement) {
            const requirement = await client.requirements.create({
              featureId: options.feature,
              statement: options.statement,
              kind: validateKind(options.kind),
              scopeId: options.scope,
            });
            if (useJson) outputRequirementJson(requirement);
            else {
              console.log('\n✓ Requirement added');
              outputRequirementPretty(requirement);
            }
            return;
          }

          // Batch mode: JSON array on stdin.
          if (process.stdin.isTTY) {
            throw new Error(
              'Pass -s/--statement, or pipe a JSON array of requirements on stdin.',
            );
          }
          const raw = await readStdin();
          let batch: BatchRequirementInput[];
          try {
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) throw new Error('not an array');
            batch = parsed as BatchRequirementInput[];
          } catch {
            throw new Error(
              'stdin must be a JSON array of { statement, kind?, scopeId? } objects.',
            );
          }

          const results: BatchRequirementResult[] = [];
          for (const [index, item] of batch.entries()) {
            try {
              if (!item.statement || typeof item.statement !== 'string') {
                throw new Error('missing "statement"');
              }
              const input: RequirementCreateInput = {
                featureId: options.feature,
                statement: item.statement,
                kind: validateKind(item.kind),
                scopeId: item.scopeId,
              };
              const requirement = await client.requirements.create(input);
              results.push({ index, success: true, requirement });
            } catch (error) {
              results.push({
                index,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (useJson) outputRequirementBatchJson(results);
          else outputRequirementBatchPretty(results);
          if (results.some((r) => !r.success)) process.exitCode = 1;
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  requirements
    .command('list')
    .description('List a feature\'s requirements')
    .requiredOption('--feature <id>', 'Feature CUID')
    .option('--scope <id>', 'Only requirements pinned to this scope')
    .action(
      async (options: { feature: string; scope?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const list = await client.requirements.list({
            featureId: options.feature,
            scopeId: options.scope,
          });
          if (useJson) outputRequirementsJson(list);
          else outputRequirementsPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  requirements
    .command('check')
    .description('Mark a requirement met (or unmet with --unmet)')
    .requiredOption('--id <id>', 'Requirement CUID')
    .option('--unmet', 'Mark unmet instead of met')
    .action(
      async (options: { id: string; unmet?: boolean }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const requirement = await client.requirements.setChecked(
            options.id,
            !options.unmet,
          );
          if (useJson) outputRequirementJson(requirement);
          else {
            console.log(`\n✓ Requirement marked ${options.unmet ? 'unmet' : 'met'}`);
            outputRequirementPretty(requirement);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  requirements
    .command('rm')
    .description('Delete a requirement')
    .requiredOption('--id <id>', 'Requirement CUID')
    .action(async (options: { id: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const result = await client.requirements.delete(options.id);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log('\n✓ Requirement deleted');
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return requirements;
}

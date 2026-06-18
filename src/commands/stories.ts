import { Command } from 'commander';
import type { UserStoryCreateInput } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputUserStoryJson,
  outputUserStoryPretty,
  outputUserStoriesJson,
  outputUserStoriesPretty,
  outputBatchResultsJson,
  outputBatchResultsPretty,
  type BatchStoryResult,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

// Shape of a single story object in the stdin batch array.
interface BatchStoryInput {
  asA?: string;
  iWant?: string;
  soThat?: string;
  acceptanceCriteria?: string;
  scopeId?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export function createStoriesCommand(): Command {
  const stories = new Command('stories').description(
    'Manage a feature\'s native, structured user stories (As a / I want / So that).',
  );

  stories
    .command('add')
    .description(
      [
        'Add user stories to a feature.',
        '',
        'Flag mode: pass --as-a/--i-want/--so-that (plus optional --acceptance/--scope) to add one story.',
        'Batch mode: pipe a JSON array of { asA?, iWant?, soThat?, acceptanceCriteria?, scopeId? } on stdin',
        '            to add many at once (per-item success/failure is reported).',
      ].join('\n'),
    )
    .requiredOption('--feature <id>', 'Feature CUID')
    .option('--as-a <text>', '"As a ..." actor')
    .option('--i-want <text>', '"I want ..." capability')
    .option('--so-that <text>', '"So that ..." outcome')
    .option('--acceptance <text>', 'Acceptance criteria')
    .option('--scope <id>', 'Feature scope CUID to group the story under')
    .action(
      async (
        options: {
          feature: string;
          asA?: string;
          iWant?: string;
          soThat?: string;
          acceptance?: string;
          scope?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

        const hasFlags =
          options.asA != null ||
          options.iWant != null ||
          options.soThat != null ||
          options.acceptance != null;
        // Batch mode when stdin is piped and no story flags were given.
        const isBatch = !hasFlags && !process.stdin.isTTY;

        try {
          const client = getClient();

          if (isBatch) {
            const raw = await readStdin();
            let items: BatchStoryInput[];
            try {
              const parsed: unknown = JSON.parse(raw);
              if (!Array.isArray(parsed)) {
                throw new Error('Expected a JSON array of story objects on stdin');
              }
              items = parsed as BatchStoryInput[];
            } catch (parseError) {
              throw new Error(
                `Could not parse stdin as a JSON array: ${
                  parseError instanceof Error ? parseError.message : String(parseError)
                }`,
              );
            }

            const results: BatchStoryResult[] = [];
            // Sequential so server-side displayOrder follows array order.
            for (let index = 0; index < items.length; index++) {
              const item = items[index]!;
              try {
                const story = await client.userStories.create({
                  featureId: options.feature,
                  asA: item.asA,
                  iWant: item.iWant,
                  soThat: item.soThat,
                  acceptanceCriteria: item.acceptanceCriteria,
                  scopeId: item.scopeId,
                });
                results.push({ index, ok: true, id: story.id });
              } catch (itemError) {
                results.push({
                  index,
                  ok: false,
                  error: itemError instanceof Error ? itemError.message : String(itemError),
                });
              }
            }

            if (useJson) outputBatchResultsJson(results);
            else outputBatchResultsPretty(results);

            // Non-zero exit if every item failed, so scripts can detect total failure.
            if (results.length > 0 && results.every((r) => !r.ok)) {
              process.exit(1);
            }
            return;
          }

          // Flag mode: a single story.
          const input: UserStoryCreateInput = {
            featureId: options.feature,
            asA: options.asA,
            iWant: options.iWant,
            soThat: options.soThat,
            acceptanceCriteria: options.acceptance,
            scopeId: options.scope,
          };
          const story = await client.userStories.create(input);
          if (useJson) outputUserStoryJson(story);
          else {
            console.log('\n✓ User story added');
            outputUserStoryPretty(story);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  stories
    .command('list')
    .description('List a feature\'s user stories in display order')
    .requiredOption('--feature <id>', 'Feature CUID')
    .action(
      async (options: { feature: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const list = await client.userStories.list({ featureId: options.feature });
          if (useJson) outputUserStoriesJson(list);
          else outputUserStoriesPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  return stories;
}

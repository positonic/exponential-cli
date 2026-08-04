import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  applyMentions,
  collectMention,
  MENTION_OPTION_DESCRIPTION,
} from '../utils/mentions.js';
import {
  shouldUseJson,
  outputCommentJson,
  outputCommentPretty,
  outputCommentsJson,
  outputCommentsPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

/**
 * Goal ids are integers, not cuids — the CLI parses them here so a typo fails
 * with a readable message instead of a server-side zod error.
 */
function parseGoalId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new Error(
      `Goal id must be a whole number, got "${value}". Find one with \`exponential search "<goal title>"\`.`,
    );
  }
  return id;
}

/**
 * `exponential goals comment …` — discussion on an objective.
 *
 * Goal read/write commands aren't wired up yet; discover ids with
 * `exponential search`, whose goal results carry the numeric id.
 */
export function createGoalsCommand(): Command {
  const goals = new Command('goals').description(
    'Work with goals. Find goal ids with `exponential search "<title>"`.',
  );

  const comment = new Command('comment').description(
    'Read and post comments on a goal. Mention teammates with --mention.',
  );

  comment
    .command('list')
    .description('List comments on a goal')
    .requiredOption('--goal <id>', 'Goal ID (a number)')
    .action(async (options: { goal: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const comments = await client.goalComments.list(parseGoalId(options.goal));
        if (useJson) outputCommentsJson(comments);
        else outputCommentsPretty(comments);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('add')
    .description('Add a comment to a goal')
    .requiredOption('--goal <id>', 'Goal ID (a number)')
    .requiredOption('-m, --message <text>', 'Comment content (markdown supported)')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .option('--parent-update <id>', 'Thread under a specific goal update')
    .action(
      async (
        options: {
          goal: string;
          message: string;
          mention: string[];
          workspace?: string;
          parentUpdate?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const goalId = parseGoalId(options.goal);
          const content =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const created = await client.goalComments.add({
            goalId,
            content,
            parentUpdateId: options.parentUpdate,
          });
          if (useJson) {
            outputCommentJson(created);
          } else {
            console.log('\n✓ Comment added');
            outputCommentPretty(created);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  comment
    .command('update')
    .description('Update one of your own comments')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .requiredOption('-m, --message <text>', 'New comment content')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .action(
      async (
        options: {
          commentId: string;
          message: string;
          mention: string[];
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const content =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const updated = await client.goalComments.update({
            commentId: options.commentId,
            content,
          });
          if (useJson) {
            outputCommentJson(updated);
          } else {
            console.log('\n✓ Comment updated');
            outputCommentPretty(updated);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  comment
    .command('rm')
    .description('Delete one of your own comments')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .action(async (options: { commentId: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.goalComments.delete(options.commentId);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id: options.commentId }, null, 2));
        } else {
          console.log('✓ Comment deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  goals.addCommand(comment);
  return goals;
}

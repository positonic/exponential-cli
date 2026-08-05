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
 * `exponential pages comment …` — the flat discussion feed under a knowledge
 * page. Anyone the page is shared with can comment, including read-only
 * viewers; editing and deleting are author-only.
 */
export function createPageCommentsCommand(): Command {
  const comment = new Command('comment').description(
    'Read and post comments on a page. Mention teammates with --mention.',
  );

  comment
    .command('list')
    .description('List comments on a page')
    .requiredOption('--page <id>', 'Page ID')
    .action(async (options: { page: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const comments = await client.pageComments.list(options.page);
        if (useJson) outputCommentsJson(comments);
        else outputCommentsPretty(comments);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('add')
    .description('Add a comment to a page')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('-m, --message <text>', 'Comment body (markdown supported)')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .action(
      async (
        options: {
          page: string;
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
          const body =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const created = await client.pageComments.create({
            pageId: options.page,
            body,
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
    .requiredOption('-m, --message <text>', 'New comment body')
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
          const body =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const updated = await client.pageComments.update({
            commentId: options.commentId,
            body,
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
        await client.pageComments.delete(options.commentId);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id: options.commentId }, null, 2));
        } else {
          console.log('✓ Comment deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return comment;
}

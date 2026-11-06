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
 * `exponential pages comment …` — discussion on a knowledge page: the
 * doc-level feed under the body, plus threads anchored to a span of it
 * (`add --quote`). Anyone the page is shared with can comment, including
 * read-only viewers (whose anchored threads don't highlight the body);
 * editing and deleting are author-only.
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
    .description(
      'Add a comment to a page — doc-level, or anchored to a span of the body with --quote',
    )
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('-m, --message <text>', 'Comment body (markdown supported)')
    .option(
      '--quote <text>',
      'Anchor to this span of the page body, copied exactly as it reads on the page (no markdown syntax). Refused if it matches no span, or several',
    )
    .option('--quote-prefix <text>', 'With --quote: text just before the span, to pick one of several matches')
    .option('--quote-suffix <text>', 'With --quote: text just after the span, to pick one of several matches')
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
          quote?: string;
          quotePrefix?: string;
          quoteSuffix?: string;
          mention: string[];
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (
            options.quote === undefined &&
            (options.quotePrefix !== undefined || options.quoteSuffix !== undefined)
          ) {
            throw new Error('--quote-prefix and --quote-suffix need --quote.');
          }
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
            ...(options.quote !== undefined ? { quotedText: options.quote } : {}),
            ...(options.quotePrefix !== undefined || options.quoteSuffix !== undefined
              ? { quoteContext: { prefix: options.quotePrefix, suffix: options.quoteSuffix } }
              : {}),
          });
          if (useJson) {
            outputCommentJson(created);
          } else {
            console.log(
              options.quote === undefined
                ? '\n✓ Comment added'
                : created.anchor.anchored
                  ? '\n✓ Anchored comment added'
                  : '\n✓ Comment added (not highlighted: you can view this page but not edit it)',
            );
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

  comment
    .command('reply')
    .description('Reply to a comment on a page')
    .requiredOption('--comment-id <id>', 'Comment ID to reply to')
    .requiredOption('-m, --message <text>', 'Reply body (markdown supported)')
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

          const created = await client.pageComments.reply({
            parentId: options.commentId,
            body,
          });
          if (useJson) {
            outputCommentJson(created);
          } else {
            console.log('\n✓ Reply added');
            outputCommentPretty(created);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  comment
    .command('resolve')
    .description('Resolve an anchored comment thread')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--thread <id>', 'Thread ID (anchored comments only)')
    .action(async (options: { page: string; thread: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.pageComments.resolve({
          pageId: options.page,
          threadId: options.thread,
        });
        if (useJson) {
          console.log(JSON.stringify({ resolved: true, threadId: options.thread }, null, 2));
        } else {
          console.log('✓ Thread resolved');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('unresolve')
    .description('Reopen a resolved comment thread')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--thread <id>', 'Thread ID (anchored comments only)')
    .action(async (options: { page: string; thread: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.pageComments.unresolve({
          pageId: options.page,
          threadId: options.thread,
        });
        if (useJson) {
          console.log(JSON.stringify({ resolved: false, threadId: options.thread }, null, 2));
        } else {
          console.log('✓ Thread reopened');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return comment;
}

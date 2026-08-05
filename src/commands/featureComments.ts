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
 * `exponential features comment …` — the discussion on a feature (PRD).
 *
 * Any workspace member can read and post; editing and deleting are
 * author-only, so the CLI surfaces the server's "not yours" error rather than
 * pre-checking.
 */
export function createFeatureCommentsCommand(): Command {
  const comment = new Command('comment').description(
    'Read and post comments on a feature. Mention teammates with --mention.',
  );

  comment
    .command('list')
    .description('List comments on a feature')
    .requiredOption('--feature <id>', 'Feature ID')
    .action(async (options: { feature: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const comments = await client.featureComments.list(options.feature);
        if (useJson) outputCommentsJson(comments);
        else outputCommentsPretty(comments);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('add')
    .description('Add a comment to a feature')
    .requiredOption('--feature <id>', 'Feature ID')
    .requiredOption('-m, --message <text>', 'Comment body (markdown supported)')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .option('--scope <id>', "Attach to a scope's activity feed instead of the feature")
    .action(
      async (
        options: {
          feature: string;
          message: string;
          mention: string[];
          workspace?: string;
          scope?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          // Only resolve a workspace when mentions actually need one — an
          // unmentioned comment shouldn't fail for lack of a default workspace.
          const body =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const created = await client.featureComments.create({
            featureId: options.feature,
            scopeId: options.scope,
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
    .command('reply')
    .description('Reply to a comment on a feature')
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

          const created = await client.featureComments.reply({
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

          const updated = await client.featureComments.update({
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
        await client.featureComments.delete(options.commentId);
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
    .command('resolve')
    .description('Resolve an anchored comment thread')
    .requiredOption('--feature <id>', 'Feature ID')
    .requiredOption('--thread <id>', 'Thread ID (anchored comments only)')
    .action(async (options: { feature: string; thread: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.featureComments.resolve({
          featureId: options.feature,
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
    .requiredOption('--feature <id>', 'Feature ID')
    .requiredOption('--thread <id>', 'Thread ID (anchored comments only)')
    .action(async (options: { feature: string; thread: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.featureComments.unresolve({
          featureId: options.feature,
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

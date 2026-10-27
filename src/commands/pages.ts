import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../client/index.js';
import { createPageCommentsCommand } from './pageComments.js';
import { handleError } from '../utils/errors.js';
import { parseDate, readText } from '../utils/input.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputPageDiffPretty,
  outputPageHistoryPretty,
  outputPageJson,
  outputPagePretty,
  outputPageSearchPretty,
  outputPagesJson,
  outputPagesPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--limit must be a positive integer, got "${value}"`);
  }
  return n;
}

export function createPagesCommand(): Command {
  const pages = new Command('pages').description(
    'Manage Knowledge pages (PRDs, research, technical specs). Reads are Markdown-only by default; every write is recorded in the page\'s history. Link one to a feature with "features link-page".',
  );

  pages
    .command('list')
    .description('List pages in a workspace (metadata only, no bodies)')
    .option('--workspace <slug|id>', 'Workspace (defaults to the configured default)')
    .option(
      '--search <text>',
      'Case-insensitive title match. To find pages by content or meaning use "pages search".',
    )
    .action(
      async (options: { workspace?: string; search?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const list = await client.pages.list({
            workspaceId,
            search: options.search,
          });
          if (useJson) outputPagesJson(list);
          else outputPagesPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('search <query>')
    .description(
      'Find pages by meaning: semantic hits from the Knowledge index first (with the matching passage), then pages whose title or body contain the text',
    )
    .option('--workspace <slug|id>', 'Workspace (defaults to the configured default)')
    .option('--project <id>', 'Only pages filed under this project')
    .option('-l, --limit <n>', 'Max pages (1-25, default 10)')
    .action(
      async (
        query: string,
        options: { workspace?: string; project?: string; limit?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const result = await client.pages.search({
            workspaceId,
            query,
            projectId: options.project,
            limit: parseLimit(options.limit),
          });
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else outputPageSearchPretty(result);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('get <id>')
    .description(
      'Get a page by CUID. Markdown body only by default (the editor doc is never sent). --outline shows its headings; --section reads one part.',
    )
    .option('--outline', 'Headings only (level, text, line) and the body size, no body')
    .option(
      '--section <heading>',
      'Only this heading\'s section (case-insensitive; a "## " prefix is allowed)',
    )
    .option('--full', 'Include the editor\'s ProseMirror document as well (large)')
    .action(
      async (
        id: string,
        options: { outline?: boolean; section?: string; full?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const page = await client.pages.get(id, {
            format: options.outline ? 'outline' : options.full ? 'full' : 'markdown',
            section: options.section,
          });
          if (useJson) outputPageJson(page);
          else outputPagePretty(page);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('create')
    .description('Create a page. Body: -b text, --body-file <path>, or --body-file - for stdin.')
    .option('--workspace <slug|id>', 'Workspace (defaults to the configured default)')
    .requiredOption('-t, --title <title>', 'Page title')
    .option('-b, --body <markdown>', 'Markdown body')
    .option('--body-file <path>', 'Read the Markdown body from a file ("-" = stdin)')
    .option('--project <id>', 'File the page under a project')
    .option('--source <text>', 'Where the facts come from: a URL, a document, a person')
    .option('--as-of <date>', 'The date the facts were true (YYYY-MM-DD)')
    .option('-n, --note <text>', 'Why: recorded on the page\'s first revision')
    .action(
      async (
        options: {
          workspace?: string;
          title: string;
          body?: string;
          bodyFile?: string;
          project?: string;
          source?: string;
          asOf?: string;
          note?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const page = await client.pages.create({
            workspaceId,
            projectId: options.project,
            title: options.title,
            body: readText(options.body, options.bodyFile),
            source: options.source,
            asOf: parseDate(options.asOf),
            note: options.note,
          });
          if (useJson) outputPageJson(page);
          else {
            console.log('\n✓ Page created');
            outputPagePretty(page);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('update')
    .description(
      'Update a page. Sending a body is a Markdown-source write: the Markdown becomes canonical. Pass --base-version so a newer edit by someone else is a CONFLICT, not an overwrite.',
    )
    .requiredOption('--id <id>', 'Page CUID')
    .option('-t, --title <title>', 'New title')
    .option('-b, --body <markdown>', 'New Markdown body (replaces the whole body)')
    .option('--body-file <path>', 'Read the new Markdown body from a file ("-" = stdin)')
    .option('--base-version <n>', 'The docVersion you read before editing (compare-and-set)')
    .option('-n, --note <text>', 'Why this change: shown in the page\'s history')
    .option('--source <text>', 'Where the facts come from (an empty string clears it)')
    .option('--as-of <date>', 'The date the facts were true (YYYY-MM-DD)')
    .option('--clear-as-of', 'Remove the as-of date')
    .action(
      async (
        options: {
          id: string;
          title?: string;
          body?: string;
          bodyFile?: string;
          baseVersion?: string;
          note?: string;
          source?: string;
          asOf?: string;
          clearAsOf?: boolean;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const page = await client.pages.update({
            id: options.id,
            title: options.title,
            body: readText(options.body, options.bodyFile),
            baseVersion:
              options.baseVersion === undefined ? undefined : Number(options.baseVersion),
            note: options.note,
            source: options.source,
            asOf: options.clearAsOf ? null : parseDate(options.asOf),
          });
          if (useJson) outputPageJson(page);
          else {
            console.log('\n✓ Page updated');
            outputPagePretty(page);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('history <id>')
    .description(
      'The page\'s revisions, newest first: who, when, why and the body size. Never the bodies.',
    )
    .option('-l, --limit <n>', 'Max revisions (1-200, default 50)')
    .option('--cursor <revisionId>', 'Continue from a previous page of history')
    .action(
      async (id: string, options: { limit?: string; cursor?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const history = await client.pages.history(id, {
            limit: parseLimit(options.limit),
            cursor: options.cursor,
          });
          if (useJson) console.log(JSON.stringify(history, null, 2));
          else outputPageHistoryPretty(history);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('revision <id> <revisionId>')
    .description('One revision with its Markdown body')
    .action(
      async (
        id: string,
        revisionId: string,
        _options: Record<string, never>,
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const revision = await client.pages.revision(id, revisionId);
          if (useJson) console.log(JSON.stringify(revision, null, 2));
          else {
            console.log(chalk.gray('─'.repeat(50)));
            console.log(
              `\n${chalk.bold(revision.title)}  ${chalk.gray(`v${revision.docVersion} · ${revision.kind}`)}`,
            );
            console.log(chalk.gray(`  Revision: ${revision.id}`));
            if (revision.note) console.log(`  ${chalk.gray('Note:')} ${revision.note}`);
            if (revision.body) console.log(`\n${revision.body}\n`);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('diff <id>')
    .description(
      'What a revision changed, as a unified diff of the Markdown. Defaults to the latest revision against the one before it.',
    )
    .option('--revision <revisionId>', 'The revision to inspect (default: the latest)')
    .option(
      '--against <previous|current|revisionId>',
      'What to compare with: the revision before it (default), the page as it is now, or another revision',
    )
    .action(
      async (id: string, options: { revision?: string; against?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          let revisionId = options.revision;
          if (!revisionId) {
            const latest = await client.pages.history(id, { limit: 1 });
            revisionId = latest.revisions[0]?.id;
            if (!revisionId) throw new Error('This page has no revisions yet.');
          }
          const diff = await client.pages.diff(id, revisionId, { against: options.against });
          if (useJson) console.log(JSON.stringify(diff, null, 2));
          else outputPageDiffPretty(diff);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  pages
    .command('restore <id>')
    .description(
      'Put a revision\'s title and body back as the page\'s current content. A forward write: the history keeps what was replaced.',
    )
    .requiredOption('--revision <revisionId>', 'The revision to restore (see "pages history")')
    .option('-n, --note <text>', 'Why: recorded on the restore revision')
    .option(
      '--base-version <n>',
      'The page version you looked at (newest revision\'s v-number in "pages history"); a newer save makes this a CONFLICT. Defaults to the newest revision now.',
    )
    .action(
      async (
        id: string,
        options: { revision: string; note?: string; baseVersion?: string },
        cmd: Command,
      ) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        let baseVersion =
          options.baseVersion === undefined ? undefined : Number(options.baseVersion);
        if (baseVersion === undefined) {
          const latest = await client.pages.history(id, { limit: 1 });
          baseVersion = latest.revisions[0]?.docVersion;
        }
        const result = await client.pages.restore(id, options.revision, {
          note: options.note,
          baseVersion,
        });
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else {
          console.log(
            `\n✓ Page restored (now v${result.docVersion}, revision ${result.revisionId})`,
          );
        }
      } catch (error) {
        handleError(error, useJson);
      }
      },
    );

  pages.addCommand(createPageCommentsCommand());

  return pages;
}

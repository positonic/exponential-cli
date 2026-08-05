import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { createPageCommentsCommand } from './pageComments.js';
import { handleError } from '../utils/errors.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputPageJson,
  outputPagePretty,
  outputPagesJson,
  outputPagesPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

/** Body from -b text, --body-file path, or "-" for stdin. */
function readBody(body?: string, bodyFile?: string): string | undefined {
  if (body !== undefined) return body;
  if (bodyFile === undefined) return undefined;
  if (bodyFile === '-') return readFileSync(0, 'utf-8');
  return readFileSync(bodyFile, 'utf-8');
}

export function createPagesCommand(): Command {
  const pages = new Command('pages').description(
    'Manage Knowledge pages (PRDs, research, technical specs). Link one to a feature with "features link-page".',
  );

  pages
    .command('list')
    .description('List pages in a workspace')
    .option('--workspace <slug|id>', 'Workspace (defaults to the configured default)')
    .option('--search <text>', 'Filter by title/content')
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
    .command('get <id>')
    .description('Get a page by CUID (body is Markdown)')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const page = await client.pages.get(id);
        if (useJson) outputPageJson(page);
        else outputPagePretty(page);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  pages
    .command('create')
    .description('Create a page. Body: -b text, --body-file <path>, or --body-file - for stdin.')
    .option('--workspace <slug|id>', 'Workspace (defaults to the configured default)')
    .requiredOption('-t, --title <title>', 'Page title')
    .option('-b, --body <markdown>', 'Markdown body')
    .option('--body-file <path>', 'Read the Markdown body from a file ("-" = stdin)')
    .action(
      async (
        options: { workspace?: string; title: string; body?: string; bodyFile?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const page = await client.pages.create({
            workspaceId,
            title: options.title,
            body: readBody(options.body, options.bodyFile),
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
      'Update a page. Sending a body is a Markdown-source write: the Markdown becomes canonical.',
    )
    .requiredOption('--id <id>', 'Page CUID')
    .option('-t, --title <title>', 'New title')
    .option('-b, --body <markdown>', 'New Markdown body (replaces the whole body)')
    .option('--body-file <path>', 'Read the new Markdown body from a file ("-" = stdin)')
    .action(
      async (
        options: { id: string; title?: string; body?: string; bodyFile?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const page = await client.pages.update({
            id: options.id,
            title: options.title,
            body: readBody(options.body, options.bodyFile),
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

  pages.addCommand(createPageCommentsCommand());

  return pages;
}

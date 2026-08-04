import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { shouldUseJson } from '../utils/output.js';
import type { SearchResult, Workspace } from 'exponential-sdk';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

interface SearchOptions {
  workspace?: string;
  limit?: string;
}

const TYPE_LABELS: Record<string, string> = {
  workspace: 'Workspaces',
  project: 'Projects',
  action: 'Actions',
  goal: 'Goals',
  keyResult: 'Key Results',
  outcome: 'Outcomes',
  ticket: 'Tickets',
  feature: 'Features',
  epic: 'Epics',
  page: 'Pages',
  meeting: 'Meetings',
  contact: 'Contacts',
  organization: 'Organizations',
  product: 'Products',
};

export function createSearchCommand(): Command {
  const search = new Command('search')
    .description(
      "Global search across projects, actions, goals, workspaces and more — same coverage as the app's Cmd+K palette",
    )
    .argument('<query>', 'Text to search for')
    .option('-w, --workspace <slug>', 'Restrict results to one workspace (slug or ID)')
    .option('-l, --limit <n>', 'Max results per entity type (1-25, default 10)')
    .action(async (query: string, options: SearchOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();

        let workspaceId: string | undefined;
        if (options.workspace) {
          const workspaces = await client.workspaces.list();
          const match = workspaces.find(
            (w: Workspace) => w.slug === options.workspace || w.id === options.workspace,
          );
          if (!match) {
            console.error(chalk.red(`Workspace "${options.workspace}" not found.`));
            console.log(chalk.gray('Available workspaces:'));
            workspaces.forEach((w: Workspace) => {
              console.log(chalk.gray(`  - ${w.slug} (${w.name})`));
            });
            process.exit(1);
          }
          workspaceId = match.id;
        }

        const limit = options.limit ? Number(options.limit) : undefined;
        const result = await client.search.global({ query, workspaceId, limit });

        if (useJson) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.results.length === 0) {
          console.log(chalk.gray(`No matches for "${result.query}".`));
          return;
        }

        const byType = new Map<string, SearchResult[]>();
        for (const r of result.results) {
          const bucket = byType.get(r.type) ?? [];
          bucket.push(r);
          byType.set(r.type, bucket);
        }

        for (const [type, rows] of byType) {
          console.log(chalk.bold(`\n${TYPE_LABELS[type] ?? type}`));
          for (const row of rows) {
            const parts = [chalk.white(row.title)];
            if (row.subtitle) parts.push(chalk.gray(row.subtitle));
            if (row.workspace) parts.push(chalk.cyan(`@${row.workspace.slug}`));
            console.log(`  ${parts.join(chalk.gray(' · '))}`);
            console.log(chalk.gray(`    ${row.id}${row.url ? `  ${row.url}` : ''}`));
          }
        }
        console.log();
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return search;
}

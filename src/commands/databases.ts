import { Command } from 'commander';
import chalk from 'chalk';
import type {
  AddablePropertyType,
  Database,
  DatabaseFilter,
  DatabaseView,
  PropertyDef,
  SelectOptionInput,
  CsvMapping,
} from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { readText } from '../utils/input.js';
import {
  shouldUseJson,
  outputCsvPreviewPretty,
  outputCsvSkipped,
  outputDatabaseJson,
  outputDatabasePretty,
  outputDatabasesPretty,
  outputRowJson,
  outputRowPretty,
  outputRowsPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const ADDABLE_TYPES: AddablePropertyType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'person',
  'createdTime',
  'lastEditedTime',
  'createdBy',
];

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--limit must be a positive integer, got "${value}"`);
  }
  return n;
}

/**
 * `--set Name=value` pairs → a values map keyed by property name (or id). The
 * first `=` splits; the server checks each value against the property's type
 * (a select by option name, a list as comma-separated text, a checkbox as
 * yes/no, a date as ISO). An empty value clears the cell.
 */
export function parseSet(pairs: string[], cleared: string[] = []): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0) {
      throw new Error(`--set expects Property=value, got "${pair}"`);
    }
    const key = pair.slice(0, at).trim();
    const raw = pair.slice(at + 1);
    values[key] = raw === '' ? null : raw;
  }
  for (const key of cleared) values[key.trim()] = null;
  return values;
}

/**
 * `rows import` flags → a CSV mapping. `--map "Col=Property"` sends a column
 * to an existing property (by name or id, resolved against the database);
 * `--new "Col=type"` creates a property named after the column (`--new
 * "Col=Owner:text"` names it); `--skip Col` leaves one out. Columns not
 * named are left to the server's suggestion, which the preview reports.
 */
export function parseCsvMapping(
  database: Database,
  flags: { map: string[]; new: string[]; skip: string[] },
): CsvMapping {
  const mapping: CsvMapping = {};
  const split = (pair: string, flag: string): [string, string] => {
    const at = pair.indexOf('=');
    if (at <= 0) throw new Error(`${flag} expects Column=value, got "${pair}"`);
    return [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
  };
  for (const pair of flags.map) {
    const [column, property] = split(pair, '--map');
    mapping[column] = { kind: 'property', propertyId: resolveProperty(database, property).id };
  }
  for (const pair of flags.new) {
    const [column, spec] = split(pair, '--new');
    const colon = spec.indexOf(':');
    const name = colon > 0 ? spec.slice(0, colon).trim() : column;
    const type = colon > 0 ? spec.slice(colon + 1).trim() : spec;
    mapping[column] = { kind: 'new', name, type: parsePropertyType(type) };
  }
  for (const column of flags.skip) mapping[column.trim()] = { kind: 'skip' };
  return mapping;
}

/** `--type <t>` → an addable property type, or a clear error naming them. */
export function parsePropertyType(value: string): AddablePropertyType {
  if ((ADDABLE_TYPES as string[]).includes(value)) return value as AddablePropertyType;
  throw new Error(`--type must be one of: ${ADDABLE_TYPES.join(', ')} (got "${value}")`);
}

/**
 * `--options "Not measured, Tracked, Dropped:red"` → select options. A
 * `name:color` suffix picks a palette colour; the rest are assigned in turn.
 */
export function parseOptions(value: string | undefined): SelectOptionInput[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.lastIndexOf(':');
      if (at > 0) {
        return { name: part.slice(0, at).trim(), color: part.slice(at + 1).trim() as SelectOptionInput['color'] };
      }
      return { name: part };
    });
}

/**
 * One `--filter` expression: `Prop=value` (equals; a select by option name),
 * `Prop!=value`, `Prop~text` (contains), `Prop>n` / `Prop<n`, `Prop=` (empty),
 * `Prop!=` (not empty), `Prop in a,b` (any of). The property is a name or id.
 */
export function parseFilter(expression: string): { property: string; op: DatabaseFilter['op']; value?: unknown } {
  const match = /^\s*(.+?)\s*(!=|>=|<=|=|~|>|<| in )\s*(.*)$/.exec(expression);
  if (!match) throw new Error(`--filter expects Property=value (or !=, ~, >, <, in), got "${expression}"`);
  const [, property, operator, value] = match as unknown as [string, string, string, string];
  switch (operator.trim()) {
    case '=':
      return value === '' ? { property, op: 'isEmpty' } : { property, op: 'eq', value };
    case '!=':
      return value === '' ? { property, op: 'isNotEmpty' } : { property, op: 'neq', value };
    case '~':
      return { property, op: 'contains', value };
    case '>':
      return { property, op: 'gt', value };
    case '<':
      return { property, op: 'lt', value };
    case '>=':
    case '<=':
      // The server has only strict comparisons; narrowing silently would drop the boundary rows.
      throw new Error(`--filter does not support "${operator.trim()}" (only > and <), got "${expression}"`);
    case 'in':
      return { property, op: 'anyOf', value: value.split(',').map((s) => s.trim()).filter(Boolean) };
    default:
      throw new Error(`Unknown filter operator "${operator}"`);
  }
}

/** `--sort "Score:desc"` or `--sort Score` (ascending). */
export function parseSort(value: string | undefined): { property: string; direction: 'asc' | 'desc' } | undefined {
  if (value === undefined) return undefined;
  const at = value.lastIndexOf(':');
  const property = at > 0 ? value.slice(0, at).trim() : value.trim();
  const direction = at > 0 ? value.slice(at + 1).trim().toLowerCase() : 'asc';
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error(`--sort expects Property or Property:asc|desc, got "${value}"`);
  }
  return { property, direction };
}

/** The property a name or id refers to, or an error that lists what exists. */
export function resolveProperty(database: Database, key: string): PropertyDef {
  const byId = database.properties.find((p) => p.id === key);
  if (byId) return byId;
  const wanted = key.trim().toLowerCase();
  const byName = database.properties.filter((p) => p.name.trim().toLowerCase() === wanted);
  if (byName.length === 1) return byName[0]!;
  throw new Error(
    `No property "${key}" on ${database.name}. Properties: ${database.properties.map((p) => p.name).join(', ')}`,
  );
}

/**
 * Build the view a `rows list` with `--filter`/`--sort` reads through: the
 * saved view, with the given filters in place of the saved ones when any
 * were passed, and the given sort in place of the saved one when passed —
 * so `--sort` alone keeps the saved filters. Names are resolved to ids here
 * because the server requires a view to name properties by id.
 */
export function buildListView(
  database: Database,
  filters: string[],
  sort: string | undefined,
): DatabaseView | undefined {
  if (filters.length === 0 && sort === undefined) return undefined;
  const parsedSort = parseSort(sort);
  return {
    ...database.view,
    sort: parsedSort
      ? { propertyId: resolveProperty(database, parsedSort.property).id, direction: parsedSort.direction }
      : database.view.sort,
    filters:
      filters.length === 0
        ? database.view.filters
        : filters.map((expression) => {
            const { property, op, value } = parseFilter(expression);
            return { propertyId: resolveProperty(database, property).id, op, ...(value !== undefined ? { value } : {}) };
          }),
  };
}

export function createDatabasesCommand(): Command {
  const databases = new Command('databases').description(
    'Databases: typed tables inside pages. A database is a block in a page body, owned by that page; each row is a page of its own (read it with "pages get <rowId>"). Writes are typed per property — a bad value is refused naming the property. Not a work tracker: use tickets, actions and projects for work.',
  );

  databases
    .command('create')
    .description(
      'Create a database on a page (with a title property) and place its block at the end of the page body. --no-place leaves the body alone and prints the marker to put in yourself.',
    )
    .requiredOption('--page <id>', 'The page that will hold the database (you need edit access)')
    .requiredOption('--name <name>', 'Database name, e.g. Metrics')
    .option('--no-place', 'Do not append the marker to the page body')
    .option('-n, --note <text>', 'Why: recorded on the page revision that places the block')
    .action(
      async (options: { page: string; name: string; place: boolean; note?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const database = await client.databases.create({ pageId: options.page, name: options.name });
          let placed = false;
          if (options.place && database.marker) {
            const page = await client.pages.get(options.page);
            const body = page.body?.trimEnd();
            await client.pages.update({
              id: options.page,
              body: body ? `${body}\n\n${database.marker}` : database.marker,
              baseVersion: page.docVersion,
              note: options.note ?? `Add the ${database.name} database`,
            });
            placed = true;
          }
          if (useJson) outputDatabaseJson({ ...database, placed } as Database & { placed: boolean });
          else {
            console.log(`\n✓ Database created${placed ? ` and placed in "${database.page.title}"` : ''}`);
            outputDatabasePretty(database);
            if (!placed && database.marker) {
              console.log(chalk.gray(`  Put this line in the page body to show it: ${database.marker}\n`));
            }
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  databases
    .command('get <id>')
    .description('One database: its properties, saved view, row count and holding page')
    .action(async (id: string, _options: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const database = await getClient().databases.get(id);
        if (useJson) outputDatabaseJson(database);
        else outputDatabasePretty(database);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  databases
    .command('list')
    .description('The databases a page holds, detached ones included (a detached database\'s block is out of the body; its rows wait 30 days for the purge)')
    .requiredOption('--page <id>', 'Page CUID')
    .action(async (options: { page: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const list = await getClient().databases.list(options.page);
        if (useJson) console.log(JSON.stringify(list, null, 2));
        else outputDatabasesPretty(list);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  databases
    .command('update')
    .description('Rename a database, or replace its saved view whole (JSON: { sort?, filters, hiddenPropertyIds, propertyOrder })')
    .requiredOption('--id <id>', 'Database CUID')
    .option('--name <name>', 'New name')
    .option('--view <json>', 'The whole view as JSON')
    .option('--view-file <path>', 'Read the view JSON from a file ("-" = stdin)')
    .action(
      async (options: { id: string; name?: string; view?: string; viewFile?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const viewText = readText(options.view, options.viewFile);
          const view = viewText === undefined ? undefined : (JSON.parse(viewText) as DatabaseView);
          const database = await getClient().databases.update({ id: options.id, name: options.name, view });
          if (useJson) outputDatabaseJson(database);
          else {
            console.log('\n✓ Database updated');
            outputDatabasePretty(database);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  databases
    .command('delete <id>')
    .description('Delete a database and every row with it. Removing the block from the page only detaches; this is the delete.')
    .requiredOption('--yes', 'Confirm: the rows are pages and they go too')
    .action(async (id: string, _options: { yes: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const result = await getClient().databases.delete(id);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log(`\n✓ Database ${result.id} deleted with ${result.rowCount} row${result.rowCount === 1 ? '' : 's'}\n`);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  databases.addCommand(createPropertiesCommand());
  databases.addCommand(createRowsCommand());
  return databases;
}

function createPropertiesCommand(): Command {
  const properties = new Command('properties').description(
    'The schema: add, rename, retype, re-option, remove or reorder properties. Ids are stable — renaming never rewrites a row. A property is named by id or by name.',
  );

  properties
    .command('add <databaseId>')
    .description(`Add a property. Types: ${ADDABLE_TYPES.join(', ')} (title exists from creation; relation arrives with V3).`)
    .requiredOption('--name <name>', 'Property name')
    .requiredOption('--type <type>', 'Property type')
    .option('--options <list>', 'select/multiSelect options, comma-separated; "Name:color" picks a palette colour')
    .option('--description <text>', 'What the property means')
    .action(
      async (
        databaseId: string,
        options: { name: string; type: string; options?: string; description?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const result = await getClient().databases.addProperty({
            id: databaseId,
            name: options.name,
            type: parsePropertyType(options.type),
            description: options.description,
            options: parseOptions(options.options),
          });
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else {
            console.log(`\n✓ Property "${result.property.name}" (${result.property.type}) added — id ${result.property.id}`);
            outputDatabasePretty(result.database);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  properties
    .command('update <databaseId> <property>')
    .description('Rename, retype, re-option or describe a property. --options replaces the whole list; "id=Name" keeps an existing option under a new name.')
    .option('--name <name>', 'New name')
    .option('--type <type>', 'New type (not for the title property)')
    .option('--options <list>', 'The full option list, comma-separated; prefix "optionId=" to keep an existing option')
    .option('--description <text>', 'New description')
    .option('--clear-description', 'Remove the description')
    .action(
      async (
        databaseId: string,
        property: string,
        options: { name?: string; type?: string; options?: string; description?: string; clearDescription?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const parsedOptions = parseOptions(options.options)?.map((option) => {
            const at = option.name.indexOf('=');
            return at > 0 ? { ...option, id: option.name.slice(0, at).trim(), name: option.name.slice(at + 1).trim() } : option;
          });
          const result = await getClient().databases.updateProperty({
            id: databaseId,
            propertyId: property,
            name: options.name,
            type: options.type === undefined ? undefined : parsePropertyType(options.type),
            description: options.clearDescription ? null : options.description,
            options: parsedOptions,
          });
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else {
            console.log(`\n✓ Property "${result.property.name}" updated`);
            outputDatabasePretty(result.database);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  properties
    .command('remove <databaseId> <property>')
    .description('Remove a property from the schema and the view. Row values under it stay until each row is next written. The title property cannot be removed.')
    .action(async (databaseId: string, property: string, _options: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const database = await getClient().databases.removeProperty(databaseId, property);
        if (useJson) outputDatabaseJson(database);
        else {
          console.log('\n✓ Property removed');
          outputDatabasePretty(database);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  properties
    .command('reorder <databaseId> <propertyIds...>')
    .description('Set the column order. List every property id exactly once (space- or comma-separated).')
    .action(async (databaseId: string, propertyIds: string[], _options: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const ids = propertyIds.flatMap((part) => part.split(',')).map((s) => s.trim()).filter(Boolean);
        const database = await getClient().databases.reorderProperties(databaseId, ids);
        if (useJson) outputDatabaseJson(database);
        else {
          console.log('\n✓ Properties reordered');
          outputDatabasePretty(database);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return properties;
}

function createRowsCommand(): Command {
  const rows = new Command('rows').description(
    'Rows: each is a page of the database. Write values with repeatable --set Property=value; read a row\'s body and history with "pages get <rowId>" / "pages history <rowId>".',
  );

  rows
    .command('list <databaseId>')
    .description(
      'Rows through the saved view, or with your own --filter/--sort: "Status=Tracked", "Score>5", "Owner!=", "Name~latency", "Status in Tracked,Instrumenting".',
    )
    .option('--filter <expr>', 'Filter (repeatable); replaces the saved filters', collect, [])
    .option('--sort <prop[:asc|desc]>', 'Sort; replaces the saved sort')
    .option('-l, --limit <n>', 'Rows per page (1-200, default 50)')
    .option('--cursor <cursor>', 'Continue from a previous page (nextCursor)')
    .action(
      async (
        databaseId: string,
        options: { filter: string[]; sort?: string; limit?: string; cursor?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          // The definition names the columns (and resolves --filter/--sort names to ids).
          const database = await client.databases.get(databaseId);
          const page = await client.databases.listRows(databaseId, {
            view: buildListView(database, options.filter, options.sort),
            limit: parseLimit(options.limit),
            cursor: options.cursor,
          });
          if (useJson) console.log(JSON.stringify(page, null, 2));
          else outputRowsPretty(page, database);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  rows
    .command('add <databaseId>')
    .description(
      'Add a row. --set Name="Alert latency" --set Status=Tracked (repeatable; property by name or id; a select by option name, lists comma-separated, dates ISO, checkboxes yes/no).',
    )
    .option('--set <Property=value>', 'A cell value (repeatable)', collect, [])
    .option('-n, --note <text>', 'Why: recorded on the row page\'s first revision')
    .action(async (databaseId: string, options: { set: string[]; note?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const row = await client.databases.createRow(databaseId, parseSet(options.set), { note: options.note });
        if (useJson) outputRowJson(row);
        else {
          console.log('\n✓ Row added');
          outputRowPretty(row, await client.databases.get(databaseId));
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  rows
    .command('import <databaseId>')
    .description(
      'Import a CSV: --csv file (or - for stdin). Columns map to properties by header name; --map "Col=Property", --new "Col=type" (or "Col=Name:type") and --skip Col override. --dry-run shows the typed preview and creates nothing. Rows with a cell that does not fit are reported and left out.',
    )
    .requiredOption('--csv <file>', 'The CSV file, or - for stdin')
    .option('--map <Col=Property>', 'Send a column to an existing property (repeatable)', collect, [])
    .option('--new <Col=type>', 'Create a property for a column (repeatable)', collect, [])
    .option('--skip <Col>', 'Leave a column out (repeatable)', collect, [])
    .option('--dry-run', 'Preview only: type every row, create nothing')
    .option('-n, --note <text>', 'Why: recorded on each new row\'s first revision')
    .action(
      async (
        databaseId: string,
        options: { csv: string; map: string[]; new: string[]; skip: string[]; dryRun?: boolean; note?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const csv = readText(undefined, options.csv);
          if (!csv?.trim()) throw new Error('The CSV is empty');
          const client = getClient();
          const database = await client.databases.get(databaseId);
          const overrides = parseCsvMapping(database, options);
          // The server suggests the rest of the mapping by header name; take
          // its full mapping so the commit uses exactly what was previewed.
          const suggested = await client.databases.previewCsv(databaseId, csv);
          const mapping = { ...suggested.mapping, ...overrides };
          const preview =
            Object.keys(overrides).length > 0 ? await client.databases.previewCsv(databaseId, csv, mapping) : suggested;
          if (options.dryRun) {
            if (useJson) console.log(JSON.stringify(preview, null, 2));
            else outputCsvPreviewPretty(preview);
            return;
          }
          const result = await client.databases.commitCsv(databaseId, csv, mapping, { note: options.note });
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else {
            console.log(`\n✓ Imported ${result.created.length} of ${result.total} row${result.total === 1 ? '' : 's'}`);
            for (const p of result.properties) console.log(`  + property ${p.name} (${p.type})`);
            outputCsvSkipped(result.skipped);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  rows
    .command('update <rowId>')
    .description('Write some of a row\'s cells: --set Property=value (repeatable), --clear Property to empty one. Other cells are kept. Recorded in the row page\'s history.')
    .option('--set <Property=value>', 'A cell value (repeatable)', collect, [])
    .option('--clear <Property>', 'Empty a cell (repeatable)', collect, [])
    .option('-n, --note <text>', 'Why: shown in the row page\'s history')
    .action(
      async (rowId: string, options: { set: string[]; clear: string[]; note?: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const values = parseSet(options.set, options.clear);
          if (Object.keys(values).length === 0) {
            throw new Error('Nothing to write: pass at least one --set Property=value or --clear Property');
          }
          const client = getClient();
          const row = await client.databases.updateRow(rowId, values, { note: options.note });
          if (useJson) outputRowJson(row);
          else {
            console.log('\n✓ Row updated');
            outputRowPretty(row, row.databaseId ? await client.databases.get(row.databaseId) : undefined);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  rows
    .command('delete <rowId>')
    .description('Delete a row (the page and its search chunks)')
    .requiredOption('--yes', 'Confirm')
    .action(async (rowId: string, _options: { yes: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const result = await getClient().databases.deleteRow(rowId);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log(`\n✓ Row ${result.id} deleted\n`);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return rows;
}

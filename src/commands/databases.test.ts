import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildListView,
  createDatabasesCommand,
  parseCsvMapping,
  parseFilter,
  parseOptions,
  parsePropertyType,
  parseSet,
  parseSort,
  resolveProperty,
} from './databases.js';
import * as clientModule from '../client/index.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'exponential-sdk';

vi.mock('../client/index.js', () => ({
  getClient: vi.fn(),
  isTRPCError: () => false,
}));

const TITLE = 'ptitle000001';
const STATUS = 'pstatus00001';
const SCORE = 'pscore000001';

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    id: 'db1',
    pageId: 'page1',
    workspaceId: 'ws1',
    name: 'Metrics',
    properties: [
      { id: TITLE, name: 'Name', type: 'title' },
      {
        id: STATUS,
        name: 'Status',
        type: 'select',
        options: [
          { id: 'o_nm', name: 'Not measured', color: 'gray' },
          { id: 'o_tr', name: 'Tracked', color: 'green' },
        ],
      },
      { id: SCORE, name: 'Score', type: 'number' },
    ],
    view: { filters: [], hiddenPropertyIds: [], propertyOrder: [TITLE, STATUS, SCORE] },
    titlePropertyId: TITLE,
    detachedAt: null,
    createdById: 'u1',
    createdAt: new Date('2026-10-31'),
    updatedAt: new Date('2026-10-31'),
    page: { id: 'page1', title: 'Data strategy' },
    marker: '<!-- database:db1 -->',
    rowCount: 1,
    ...overrides,
  };
}

function makeClient() {
  const database = makeDatabase();
  const databases = {
    create: vi.fn().mockResolvedValue(database),
    get: vi.fn().mockResolvedValue(database),
    previewCsv: vi.fn().mockResolvedValue({ headers: ['Name', 'Score'], mapping: { Name: { kind: 'property', propertyId: TITLE }, Score: { kind: 'property', propertyId: SCORE } }, columns: [], rows: [], total: 2, importable: 2 }),
    commitCsv: vi.fn().mockResolvedValue({ created: ['r1', 'r2'], skipped: [], properties: [], total: 2 }),
    list: vi.fn().mockResolvedValue([database]),
    update: vi.fn().mockResolvedValue(database),
    delete: vi.fn().mockResolvedValue({ id: 'db1', rowCount: 1 }),
    addProperty: vi.fn().mockResolvedValue({ property: database.properties[1], database }),
    updateProperty: vi.fn().mockResolvedValue({ property: database.properties[1], database }),
    removeProperty: vi.fn().mockResolvedValue(database),
    reorderProperties: vi.fn().mockResolvedValue(database),
    listRows: vi.fn().mockResolvedValue({ rows: [], nextCursor: null, columns: [TITLE, STATUS, SCORE] }),
    createRow: vi.fn().mockResolvedValue({ id: 'r1', title: 'Alert latency', databaseId: 'db1', values: { [STATUS]: 'o_tr' } }),
    updateRow: vi.fn().mockResolvedValue({ id: 'r1', title: 'Alert latency', databaseId: 'db1', values: {} }),
    deleteRow: vi.fn().mockResolvedValue({ id: 'r1', databaseId: 'db1' }),
  };
  const pages = {
    get: vi.fn().mockResolvedValue({ id: 'page1', body: '# Data strategy\n\nIntro.\n', docVersion: 4 }),
    update: vi.fn().mockResolvedValue({ id: 'page1' }),
  };
  vi.mocked(clientModule.getClient).mockReturnValue(
    { databases, pages } as unknown as ReturnType<typeof clientModule.getClient>,
  );
  return { databases, pages };
}

async function run(args: string[]) {
  const cmd = createDatabasesCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: 'user' });
}

describe('parsing helpers', () => {
  it('parseSet splits at the first = and treats an empty value as a clear', () => {
    expect(parseSet(['Name=Alert latency', 'Formula=a=b', 'Owner='])).toEqual({
      Name: 'Alert latency',
      Formula: 'a=b',
      Owner: null,
    });
    expect(parseSet(['Status=Tracked'], ['Notes'])).toEqual({ Status: 'Tracked', Notes: null });
    expect(() => parseSet(['nonsense'])).toThrow(/Property=value/);
  });

  it('parsePropertyType refuses title and relation', () => {
    expect(parsePropertyType('select')).toBe('select');
    expect(() => parsePropertyType('title')).toThrow(/must be one of/);
    expect(() => parsePropertyType('relation')).toThrow(/must be one of/);
  });

  it('parseOptions reads names and an optional :color', () => {
    expect(parseOptions('Not measured, Tracked:green , Dropped')).toEqual([
      { name: 'Not measured' },
      { name: 'Tracked', color: 'green' },
      { name: 'Dropped' },
    ]);
    expect(parseOptions(undefined)).toBeUndefined();
  });

  it('parseFilter understands =, !=, ~, >, <, in and the empty forms', () => {
    expect(parseFilter('Status=Tracked')).toEqual({ property: 'Status', op: 'eq', value: 'Tracked' });
    expect(parseFilter('Status!=Tracked')).toEqual({ property: 'Status', op: 'neq', value: 'Tracked' });
    expect(parseFilter('Name~latency')).toEqual({ property: 'Name', op: 'contains', value: 'latency' });
    expect(parseFilter('Score>5')).toEqual({ property: 'Score', op: 'gt', value: '5' });
    expect(parseFilter('Score<5')).toEqual({ property: 'Score', op: 'lt', value: '5' });
    expect(() => parseFilter('Score>=5')).toThrow(/does not support ">="/);
    expect(() => parseFilter('Score<=5')).toThrow(/does not support "<="/);
    expect(parseFilter('Owner=')).toEqual({ property: 'Owner', op: 'isEmpty' });
    expect(parseFilter('Owner!=')).toEqual({ property: 'Owner', op: 'isNotEmpty' });
    expect(parseFilter('Status in Tracked, Instrumenting')).toEqual({
      property: 'Status',
      op: 'anyOf',
      value: ['Tracked', 'Instrumenting'],
    });
    expect(() => parseFilter('Status')).toThrow(/--filter expects/);
  });

  it('parseSort defaults to ascending', () => {
    expect(parseSort('Score')).toEqual({ property: 'Score', direction: 'asc' });
    expect(parseSort('Score:desc')).toEqual({ property: 'Score', direction: 'desc' });
    expect(() => parseSort('Score:sideways')).toThrow(/asc\|desc/);
  });

  it('resolveProperty takes an id or a unique name and lists the properties on a miss', () => {
    const db = makeDatabase();
    expect(resolveProperty(db, SCORE).name).toBe('Score');
    expect(resolveProperty(db, 'status').id).toBe(STATUS);
    expect(() => resolveProperty(db, 'Owner')).toThrow(/No property "Owner" on Metrics\. Properties: Name, Status, Score/);
  });

  it('buildListView keeps the saved view and swaps in resolved filters and sort', () => {
    const db = makeDatabase({ view: { filters: [{ propertyId: SCORE, op: 'gt', value: 1 }], hiddenPropertyIds: [SCORE], propertyOrder: [] } });
    expect(buildListView(db, [], undefined)).toBeUndefined();
    // --sort alone keeps the saved filters.
    expect(buildListView(db, [], 'Score')).toEqual({
      sort: { propertyId: SCORE, direction: 'asc' },
      filters: [{ propertyId: SCORE, op: 'gt', value: 1 }],
      hiddenPropertyIds: [SCORE],
      propertyOrder: [],
    });
    expect(buildListView(db, ['Status=Tracked', 'Score>5'], 'score:desc')).toEqual({
      sort: { propertyId: SCORE, direction: 'desc' },
      filters: [
        { propertyId: STATUS, op: 'eq', value: 'Tracked' },
        { propertyId: SCORE, op: 'gt', value: '5' },
      ],
      hiddenPropertyIds: [SCORE],
      propertyOrder: [],
    });
  });
});

describe('databases commands', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('create makes the database and places its marker at the end of the page body', async () => {
    const { databases, pages } = makeClient();
    await run(['create', '--page', 'page1', '--name', 'Metrics']);
    expect(databases.create).toHaveBeenCalledWith({ pageId: 'page1', name: 'Metrics' });
    expect(pages.update).toHaveBeenCalledWith({
      id: 'page1',
      body: '# Data strategy\n\nIntro.\n\n<!-- database:db1 -->',
      baseVersion: 4,
      note: 'Add the Metrics database',
    });
  });

  it('create --no-place leaves the page body alone', async () => {
    const { pages } = makeClient();
    await run(['create', '--page', 'page1', '--name', 'Metrics', '--no-place']);
    expect(pages.update).not.toHaveBeenCalled();
  });

  it('properties add passes type and options through', async () => {
    const { databases } = makeClient();
    await run(['properties', 'add', 'db1', '--name', 'Status', '--type', 'select', '--options', 'Not measured,Tracked:green']);
    expect(databases.addProperty).toHaveBeenCalledWith({
      id: 'db1',
      name: 'Status',
      type: 'select',
      description: undefined,
      options: [{ name: 'Not measured' }, { name: 'Tracked', color: 'green' }],
    });
  });

  it('properties update keeps an option by "id=Name" and can clear the description', async () => {
    const { databases } = makeClient();
    await run(['properties', 'update', 'db1', 'Status', '--options', 'o_tr=Being tracked,Dropped', '--clear-description']);
    expect(databases.updateProperty).toHaveBeenCalledWith({
      id: 'db1',
      propertyId: 'Status',
      name: undefined,
      type: undefined,
      description: null,
      options: [{ id: 'o_tr', name: 'Being tracked' }, { name: 'Dropped' }],
    });
  });

  it('properties reorder accepts space- or comma-separated ids', async () => {
    const { databases } = makeClient();
    await run(['properties', 'reorder', 'db1', `${SCORE},${TITLE}`, STATUS]);
    expect(databases.reorderProperties).toHaveBeenCalledWith('db1', [SCORE, TITLE, STATUS]);
  });

  it('rows add sends --set pairs as values with the note', async () => {
    const { databases } = makeClient();
    await run(['rows', 'add', 'db1', '--set', 'Name=Alert latency', '--set', 'Status=Tracked', '-n', 'From CLEAR']);
    expect(databases.createRow).toHaveBeenCalledWith('db1', { Name: 'Alert latency', Status: 'Tracked' }, { note: 'From CLEAR' });
  });

  it('rows import reads the file, merges the server suggestion with --map/--new/--skip, previews with the full mapping and commits it', async () => {
    const { databases } = makeClient();
    const file = join(mkdtempSync(join(tmpdir(), 'csv-')), 'metrics.csv');
    writeFileSync(file, 'Name,Score,Owner\nUptime,99,Ana\n');
    await run(['rows', 'import', 'db1', '--csv', file, '--new', 'Owner=text', '-n', 'Q3 sheet']);
    const mapping = {
      Name: { kind: 'property', propertyId: TITLE },
      Score: { kind: 'property', propertyId: SCORE },
      Owner: { kind: 'new', name: 'Owner', type: 'text' },
    };
    expect(databases.previewCsv).toHaveBeenNthCalledWith(1, 'db1', 'Name,Score,Owner\nUptime,99,Ana\n');
    expect(databases.previewCsv).toHaveBeenNthCalledWith(2, 'db1', 'Name,Score,Owner\nUptime,99,Ana\n', mapping);
    expect(databases.commitCsv).toHaveBeenCalledWith('db1', 'Name,Score,Owner\nUptime,99,Ana\n', mapping, { note: 'Q3 sheet' });
  });

  it('rows import --dry-run previews and creates nothing', async () => {
    const { databases } = makeClient();
    const file = join(mkdtempSync(join(tmpdir(), 'csv-')), 'metrics.csv');
    writeFileSync(file, 'Name\nUptime\n');
    await run(['rows', 'import', 'db1', '--csv', file, '--dry-run']);
    expect(databases.previewCsv).toHaveBeenCalledTimes(1);
    expect(databases.commitCsv).not.toHaveBeenCalled();
  });

  it('parseCsvMapping resolves --map by property name, names --new columns, and skips', () => {
    const database = makeDatabase();
    expect(parseCsvMapping(database, { map: ['Metric=name'], new: ['Owner=text', 'Due=Due date:date'], skip: ['Notes'] })).toEqual({
      Metric: { kind: 'property', propertyId: TITLE },
      Owner: { kind: 'new', name: 'Owner', type: 'text' },
      Due: { kind: 'new', name: 'Due date', type: 'date' },
      Notes: { kind: 'skip' },
    });
    expect(() => parseCsvMapping(database, { map: ['Metric'], new: [], skip: [] })).toThrow(/Column=value/);
    expect(() => parseCsvMapping(database, { map: [], new: ['Owner=relation'], skip: [] })).toThrow(/--type must be/);
  });

  it('rows update sends --set and --clear, and refuses an empty write', async () => {
    const { databases } = makeClient();
    await run(['rows', 'update', 'r1', '--set', 'Status=Not measured', '--clear', 'Score']);
    expect(databases.updateRow).toHaveBeenCalledWith('r1', { Status: 'Not measured', Score: null }, { note: undefined });
    // Under vitest stdout is not a TTY, so errors go out as JSON on stdout.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run(['rows', 'update', 'r1']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const printed = vi.mocked(console.log).mock.calls.flat().map(String).join(' ');
    expect(printed).toContain('Nothing to write');
  });

  it('rows list resolves --filter and --sort names to ids and reads through that view', async () => {
    const { databases } = makeClient();
    await run(['rows', 'list', 'db1', '--filter', 'Status=Tracked', '--sort', 'Score:desc', '--limit', '10']);
    expect(databases.listRows).toHaveBeenCalledWith('db1', {
      view: {
        sort: { propertyId: SCORE, direction: 'desc' },
        filters: [{ propertyId: STATUS, op: 'eq', value: 'Tracked' }],
        hiddenPropertyIds: [],
        propertyOrder: [TITLE, STATUS, SCORE],
      },
      limit: 10,
      cursor: undefined,
    });
    await run(['rows', 'list', 'db1']);
    expect(databases.listRows).toHaveBeenLastCalledWith('db1', { view: undefined, limit: undefined, cursor: undefined });
  });

  it('delete and rows delete require --yes', async () => {
    const { databases } = makeClient();
    await expect(run(['delete', 'db1'])).rejects.toThrow();
    expect(databases.delete).not.toHaveBeenCalled();
    await run(['delete', 'db1', '--yes']);
    expect(databases.delete).toHaveBeenCalledWith('db1');
    await run(['rows', 'delete', 'r1', '--yes']);
    expect(databases.deleteRow).toHaveBeenCalledWith('r1');
  });
});

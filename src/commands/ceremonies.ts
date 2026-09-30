import { Command } from 'commander';
import chalk from 'chalk';
import type {
  CeremonyAgendaTemplateSection,
  CeremonyCreateInput,
  CeremonyImportDefinition,
  CeremonyKind,
  CeremonyUpdateInput,
  ExponentialClient,
} from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { readText, parseDate } from '../utils/input.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputCeremoniesJson,
  outputCeremoniesPretty,
  outputCeremonyJson,
  outputCeremonyPretty,
  outputCeremonyTemplatesPretty,
  outputCeremonyWritePretty,
  outputOccurrencesJson,
  outputOccurrencesPretty,
  outputOccurrenceJson,
  outputOccurrencePretty,
  outputOccurrenceUpdatesPretty,
  outputMyOccurrenceUpdatePretty,
  outputAgendaPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const KINDS: CeremonyKind[] = [
  'STANDUP',
  'PLANNING',
  'REVIEW',
  'RETROSPECTIVE',
  'PRIORITISATION',
  'ALL_HANDS',
  'ONE_ON_ONE',
  'CUSTOM',
];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseKind(value: string): CeremonyKind {
  const upper = value.toUpperCase().replace(/-/g, '_') as CeremonyKind;
  if (!KINDS.includes(upper)) {
    throw new Error(`Invalid kind "${value}". Use one of: ${KINDS.join(', ')}`);
  }
  return upper;
}

function parseIntInRange(
  value: string | undefined,
  flag: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max} (got "${value}").`);
  }
  return n;
}

const collect = (value: string, previous: string[]) => [...previous, value];

/**
 * An occurrence or ceremony reference: a bare CUID, or the web URL that
 * `exponential.im` shows for it. A URL carries its own workspace slug, so a
 * pasted link works without `--workspace` or a default workspace.
 *
 *   /w/<slug>/ceremonies/<ceremonyId>                 → ceremony
 *   /w/<slug>/ceremonies/<ceremonyId>/<occurrenceId>  → occurrence
 */
export function parseCeremonyRef(value: string): {
  workspaceSlug?: string;
  ceremonyId?: string;
  occurrenceId?: string;
  id: string;
} {
  const match = value.match(/\/w\/([^/?#]+)\/ceremonies\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (!match) return { id: value };
  const [, workspaceSlug, ceremonyId, occurrenceId] = match;
  return {
    workspaceSlug,
    ceremonyId,
    occurrenceId,
    id: occurrenceId ?? ceremonyId!,
  };
}

/**
 * A ceremony by id, or by its slug within the workspace (`leadership-weekly`).
 * Slugs cost one list call, so an id-shaped value is passed straight through.
 */
async function resolveCeremonyId(
  client: ExponentialClient,
  workspaceId: string,
  ref: string,
): Promise<string> {
  if (/^c[a-z0-9]{20,}$/.test(ref)) return ref;
  const all = await client.ceremonies.list(workspaceId, { includeInactive: true });
  const hit = all.find((c) => c.slug === ref || c.id === ref);
  if (!hit) {
    throw new Error(
      `No ceremony "${ref}" in this workspace. Run \`exponential ceremonies list\` to see slugs and ids.`,
    );
  }
  return hit.id;
}

/** Workspace for a command: the URL's slug wins, then --workspace, then the default. */
async function workspaceFor(
  client: ExponentialClient,
  ref: { workspaceSlug?: string },
  flag: string | undefined,
): Promise<string> {
  return resolveWorkspaceId(client, ref.workspaceSlug ?? flag);
}

function readAgendaTemplate(file: string | undefined): CeremonyAgendaTemplateSection[] | undefined {
  const raw = readText(undefined, file);
  if (raw === undefined) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('--agenda-file must hold a JSON array of { key, type, title, minutes?, config? } sections.');
  }
  return parsed as CeremonyAgendaTemplateSection[];
}

/** Definition flags shared by create and update. */
function addDefinitionOptions(cmd: Command): Command {
  return cmd
    .option('--name <name>', 'Display name (max 120 chars)')
    .option('--slug <slug>', 'Workspace-unique slug (derived from the name when omitted)')
    .option('--kind <kind>', `One of: ${KINDS.join(', ')}`, parseKind)
    .option(
      '--cadence <rrule>',
      'RRULE body, e.g. "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0"',
    )
    .option('--timezone <iana>', 'IANA zone the cadence runs in, e.g. Europe/Madrid')
    .option('--starts-on <date>', 'Anchor date the cadence expands from (YYYY-MM-DD)')
    .option('--duration <minutes>', 'Length in minutes (5-1440)')
    .option('--lead-time <hours>', 'Hours before the start to generate and circulate the agenda (0-336)')
    .option('--owner <userId>', 'Owner user id (defaults to you on create)')
    .option('--participant <userId>', 'Participant user id (repeatable; replaces the set on update)', collect, [])
    .option('--project <projectId>', 'Reviewed project id (repeatable; replaces the set on update)', collect, [])
    .option('--alias <title>', 'Meeting-title alias for auto-attach (repeatable; replaces the set on update)', collect, [])
    .option('--product <productId>', 'Scope to a product id')
    .option('--purpose <markdown>', 'Purpose (Markdown)')
    .option('--purpose-file <path>', 'Purpose from a file ("-" = stdin)')
    .option('--not-for <markdown>', 'What this ceremony is NOT for (Markdown)')
    .option('--inputs <markdown>', 'Required inputs (Markdown)')
    .option('--outputs <markdown>', 'Expected outputs (Markdown)')
    .option('--agenda-file <path>', 'Agenda template: JSON array of { key, type, title, minutes? } ("-" = stdin)')
    .option('--no-include-projects', 'Do not append the linked-projects section to agendas');
}

interface DefinitionOptions {
  name?: string;
  slug?: string;
  kind?: CeremonyKind;
  cadence?: string;
  timezone?: string;
  startsOn?: string;
  duration?: string;
  leadTime?: string;
  owner?: string;
  participant: string[];
  project: string[];
  alias: string[];
  product?: string;
  purpose?: string;
  purposeFile?: string;
  notFor?: string;
  inputs?: string;
  outputs?: string;
  agendaFile?: string;
  includeProjects: boolean;
}

/** Only the fields the user actually passed — update must never reset what it wasn't told about. */
function definitionFields(options: DefinitionOptions, cmd: Command): Partial<CeremonyCreateInput> {
  const fields: Partial<CeremonyCreateInput> = {};
  if (options.name !== undefined) fields.name = options.name;
  if (options.slug !== undefined) fields.slug = options.slug;
  if (options.kind !== undefined) fields.kind = options.kind;
  if (options.cadence !== undefined) fields.cadenceRule = options.cadence;
  if (options.timezone !== undefined) fields.timezone = options.timezone;
  if (options.startsOn !== undefined) fields.startsOn = parseDate(options.startsOn);
  const duration = parseIntInRange(options.duration, '--duration', 5, 24 * 60);
  if (duration !== undefined) fields.durationMinutes = duration;
  const leadTime = parseIntInRange(options.leadTime, '--lead-time', 0, 24 * 14);
  if (leadTime !== undefined) fields.leadTimeHours = leadTime;
  if (options.owner !== undefined) fields.ownerId = options.owner;
  if (options.participant.length > 0) fields.participantUserIds = options.participant;
  if (options.project.length > 0) fields.projectIds = options.project;
  if (options.alias.length > 0) fields.aliases = options.alias;
  if (options.product !== undefined) fields.productId = options.product;
  const purpose = readText(options.purpose, options.purposeFile);
  if (purpose !== undefined) fields.purpose = purpose;
  if (options.notFor !== undefined) fields.notFor = options.notFor;
  if (options.inputs !== undefined) fields.inputs = options.inputs;
  if (options.outputs !== undefined) fields.outputs = options.outputs;
  const agenda = readAgendaTemplate(options.agendaFile);
  if (agenda !== undefined) fields.agendaTemplate = agenda;
  // `--no-include-projects` defaults the option to true; only send it when set explicitly.
  if (cmd.getOptionValueSource('includeProjects') === 'cli') {
    fields.includeProjects = options.includeProjects;
  }
  return fields;
}

function createOccurrencesCommand(): Command {
  const occurrences = new Command('occurrences')
    .alias('occurrence')
    .description(
      [
        'Scheduled instances of a ceremony — the page at /w/<slug>/ceremonies/<ceremonyId>/<occurrenceId>.',
        'Every <occurrence> argument takes the occurrence CUID or that full URL (the URL brings its own workspace).',
      ].join('\n'),
    );

  occurrences
    .command('list')
    .description('Occurrences starting in a window, oldest first (max 200). Default window: 14 days either side of now.')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .option('--ceremony <slug|id>', 'Only this ceremony')
    .option('--from <date>', 'Window start (YYYY-MM-DD or ISO)')
    .option('--to <date>', 'Window end (YYYY-MM-DD or ISO)')
    .action(
      async (
        options: { workspace?: string; ceremony?: string; from?: string; to?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const ref = options.ceremony ? parseCeremonyRef(options.ceremony) : {};
          const workspaceId = await workspaceFor(client, ref, options.workspace);
          const now = Date.now();
          const from = parseDate(options.from) ?? new Date(now - 14 * DAY_MS);
          const to = parseDate(options.to) ?? new Date(now + 14 * DAY_MS);
          const ceremonyId = options.ceremony
            ? await resolveCeremonyId(client, workspaceId, parseCeremonyRef(options.ceremony).id)
            : undefined;
          const rows = await client.ceremonies.listOccurrences({ workspaceId, from, to, ceremonyId });
          if (useJson) outputOccurrencesJson(rows, { workspaceId, from, to, ceremonyId: ceremonyId ?? null });
          else outputOccurrencesPretty(rows);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  occurrences
    .command('get <occurrence>')
    .description(
      'One occurrence: status, agenda, recordings, notes page. --notes and --decisions pull in the rest of the meeting page.',
    )
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .option('--notes', "Include the occurrence's notes page body")
    .option('--decisions', 'Include decisions and open questions logged against this occurrence')
    .option('--updates', "Include participants' async updates (standups)")
    .action(
      async (
        value: string,
        options: { workspace?: string; notes?: boolean; decisions?: boolean; updates?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const ref = parseCeremonyRef(value);
          const workspaceId = await workspaceFor(client, ref, options.workspace);
          const occurrence = await client.ceremonies.getOccurrence(workspaceId, ref.id);
          const [notes, decisions, updates] = await Promise.all([
            options.notes && occurrence.notesPageId
              ? client.pages.get(occurrence.notesPageId)
              : Promise.resolve(undefined),
            // `decision.list` has no occurrence filter server-side; the log is
            // small per workspace, so filter the confirmed rows here.
            options.decisions
              ? client.decisions
                  .list({ workspaceId })
                  .then((rows) => rows.filter((d) => d.occurrenceId === occurrence.id))
              : Promise.resolve(undefined),
            options.updates
              ? client.ceremonies.updateSummary(workspaceId, occurrence.id)
              : Promise.resolve(undefined),
          ]);
          const extras = {
            ...(options.notes ? { notes: notes ?? null } : {}),
            ...(decisions ? { decisions } : {}),
            ...(updates ? { updates } : {}),
          };
          if (useJson) outputOccurrenceJson(occurrence, extras);
          else outputOccurrencePretty(occurrence, extras);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  occurrences
    .command('updates <occurrence>')
    .description("Every participant's async update for an occurrence, and who hasn't answered")
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .action(async (value: string, options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const ref = parseCeremonyRef(value);
        const workspaceId = await workspaceFor(client, ref, options.workspace);
        const summary = await client.ceremonies.updateSummary(workspaceId, ref.id);
        if (useJson) console.log(JSON.stringify(summary, null, 2));
        else outputOccurrenceUpdatesPretty(summary);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  occurrences
    .command('my-update <occurrence>')
    .description(
      [
        'Read, draft or write your own async update (standups ask: done, today, blockers).',
        'No flags: show it. --draft: fill a draft from your activity since the last occurrence.',
        '--answer key=markdown (repeatable) saves answers; --submit / --reopen changes its state.',
      ].join(' '),
    )
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .option('--draft', 'Draft answers from your activity (leaves anything you wrote alone)')
    .option('--answer <key=markdown>', 'An answer by question key (repeatable)', collect, [])
    .option('--answers-file <path>', 'Answers as a JSON object { key: markdown } ("-" = stdin)')
    .option('--blocker', 'Flag that something is blocking you')
    .option('--no-blocker', 'Clear the blocker flag')
    .option('--submit', 'Submit the update')
    .option('--reopen', 'Reopen a submitted update')
    .action(
      async (
        value: string,
        options: {
          workspace?: string;
          draft?: boolean;
          answer: string[];
          answersFile?: string;
          blocker?: boolean;
          submit?: boolean;
          reopen?: boolean;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (options.submit && options.reopen) {
            throw new Error('Pass --submit or --reopen, not both.');
          }
          const client = getClient();
          const ref = parseCeremonyRef(value);
          const workspaceId = await workspaceFor(client, ref, options.workspace);
          const blockerSet = cmd.getOptionValueSource('blocker') === 'cli';
          const writing =
            options.answer.length > 0 ||
            options.answersFile !== undefined ||
            blockerSet ||
            options.submit ||
            options.reopen;

          let update = options.draft
            ? await client.ceremonies.draftMyUpdate(workspaceId, ref.id)
            : await client.ceremonies.myUpdate(workspaceId, ref.id);

          if (writing) {
            // Save sends the whole answer map, so start from what is saved.
            const answers: Record<string, string> = { ...update.answers };
            const fromFile = readText(undefined, options.answersFile);
            if (fromFile !== undefined) Object.assign(answers, JSON.parse(fromFile) as Record<string, string>);
            for (const pair of options.answer) {
              const eq = pair.indexOf('=');
              if (eq <= 0) throw new Error(`--answer takes key=markdown (got "${pair}").`);
              answers[pair.slice(0, eq)] = pair.slice(eq + 1);
            }
            update = await client.ceremonies.saveMyUpdate({
              workspaceId,
              occurrenceId: ref.id,
              answers,
              ...(blockerSet ? { flaggedBlocker: options.blocker } : {}),
              ...(options.submit ? { submit: true } : options.reopen ? { submit: false } : {}),
            });
          }
          if (useJson) console.log(JSON.stringify(update, null, 2));
          else outputMyOccurrenceUpdatePretty(update);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  occurrences
    .command('generate-agenda <occurrence>')
    .description('Generate or regenerate the agenda (ceremony owner, or workspace owner/admin)')
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .option('--circulate', 'Also notify participants that the agenda is ready')
    .action(
      async (value: string, options: { workspace?: string; circulate?: boolean }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const ref = parseCeremonyRef(value);
          const workspaceId = await workspaceFor(client, ref, options.workspace);
          const result = await client.ceremonies.generateAgenda(workspaceId, ref.id, {
            circulate: options.circulate,
          });
          if (useJson) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(
              `✓ Agenda generated: ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}${result.circulated ? ', circulated' : ''}`,
            );
            outputAgendaPretty(result.agenda);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  occurrences
    .command('skip <occurrence>')
    .description('Skip an occurrence with a reason; participants are told (ceremony owner only)')
    .requiredOption('--reason <text>', 'Why it is skipped (1-500 chars)')
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .action(async (value: string, options: { workspace?: string; reason: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const ref = parseCeremonyRef(value);
        const workspaceId = await workspaceFor(client, ref, options.workspace);
        const result = await client.ceremonies.skipOccurrence(workspaceId, ref.id, options.reason);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log(`✓ Occurrence ${result.id} skipped`);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  occurrences
    .command('unskip <occurrence>')
    .description('Undo a skip (ceremony owner only)')
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .action(async (value: string, options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const ref = parseCeremonyRef(value);
        const workspaceId = await workspaceFor(client, ref, options.workspace);
        const result = await client.ceremonies.unskipOccurrence(workspaceId, ref.id);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log(`✓ Occurrence ${result.id} is back to ${result.status}`);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  const agenda = new Command('agenda').description("Edit an occurrence's agenda by hand");

  agenda
    .command('add <occurrence>')
    .description('Add an item to an agenda section; kept across regeneration')
    .requiredOption('--section <key>', 'The section key (see `occurrences get`)')
    .requiredOption('--title <text>', 'Item title (max 300 chars)')
    .option('--detail <text>', 'One line of detail (max 500 chars)')
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .action(
      async (
        value: string,
        options: { workspace?: string; section: string; title: string; detail?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const ref = parseCeremonyRef(value);
          const workspaceId = await workspaceFor(client, ref, options.workspace);
          const result = await client.ceremonies.addAgendaItem({
            workspaceId,
            occurrenceId: ref.id,
            sectionKey: options.section,
            title: options.title,
            detail: options.detail,
          });
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else {
            console.log('✓ Agenda item added');
            outputAgendaPretty(result.agenda);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  agenda
    .command('resolve <occurrence> <itemId>')
    .description('Mark an agenda item resolved (--reopen to undo)')
    .option('--reopen', 'Mark it unresolved again')
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .action(
      async (
        value: string,
        itemId: string,
        options: { workspace?: string; reopen?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const ref = parseCeremonyRef(value);
          const workspaceId = await workspaceFor(client, ref, options.workspace);
          const result = await client.ceremonies.resolveAgendaItem(
            workspaceId,
            ref.id,
            itemId,
            !options.reopen,
          );
          if (useJson) console.log(JSON.stringify(result, null, 2));
          else console.log(options.reopen ? '✓ Agenda item reopened' : '✓ Agenda item resolved');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  occurrences.addCommand(agenda);

  occurrences
    .command('attach <occurrence>')
    .description('Link a recorded meeting to the occurrence it captured (same workspace; you must be able to edit the meeting)')
    .requiredOption('--meeting <id>', 'Recorded meeting (transcription session) id')
    .action(async (value: string, options: { meeting: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const ref = parseCeremonyRef(value);
        const result = await client.ceremonies.attachMeeting(options.meeting, ref.id);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log(`✓ Meeting ${result.meetingId} attached to occurrence ${result.occurrenceId}`);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  occurrences
    .command('detach <meetingId>')
    .description('Unlink a recorded meeting from its occurrence')
    .action(async (meetingId: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const result = await client.ceremonies.detachMeeting(meetingId);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log(`✓ Meeting ${result.meetingId} detached`);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return occurrences;
}

export function createCeremoniesCommand(): Command {
  const ceremonies = new Command('ceremonies').description(
    [
      'Recurring meeting definitions (Settings → Ceremonies) and their scheduled occurrences.',
      '',
      'A ceremony has a cadence (RRULE in a time zone), an owner, participants and an agenda template.',
      'Each scheduled instance is an occurrence — see `ceremonies occurrences --help`.',
      'Decisions logged in an occurrence live under `exponential decisions` (--occurrence).',
    ].join('\n'),
  );

  ceremonies
    .command('list')
    .description('Ceremonies in a workspace, active first')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .option('--include-inactive', 'Also list retired ceremonies')
    .action(async (options: { workspace?: string; includeInactive?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const rows = await client.ceremonies.list(workspaceId, {
          includeInactive: options.includeInactive,
        });
        if (useJson) outputCeremoniesJson(rows, { workspaceId });
        else outputCeremoniesPretty(rows);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  ceremonies
    .command('get <ceremony>')
    .description('One ceremony with participants, projects and its recent + upcoming occurrences. Takes an id, slug or URL.')
    .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
    .action(async (value: string, options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const ref = parseCeremonyRef(value);
        const workspaceId = await workspaceFor(client, ref, options.workspace);
        const id = await resolveCeremonyId(client, workspaceId, ref.ceremonyId ?? ref.id);
        const ceremony = await client.ceremonies.get(workspaceId, id);
        if (useJson) outputCeremonyJson(ceremony);
        else outputCeremonyPretty(ceremony);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  ceremonies
    .command('templates')
    .description('Built-in ceremony templates, one per kind (the "Add from template" list)')
    .action(async (_options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const templates = await getClient().ceremonies.templates();
        if (useJson) console.log(JSON.stringify({ templates, total: templates.length }, null, 2));
        else outputCeremonyTemplatesPretty(templates);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  const create = addDefinitionOptions(
    ceremonies
      .command('create')
      .description(
        'Create a ceremony and schedule its first occurrences. Needs --name, --cadence, --timezone and --starts-on.',
      )
      .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
      .option('--template <slug>', 'Start from a built-in template (see `ceremonies templates`); flags override it'),
  );
  create.action(
    async (options: DefinitionOptions & { workspace?: string; template?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        let base: Partial<CeremonyCreateInput> = {};
        if (options.template) {
          const templates = await client.ceremonies.templates();
          const t = templates.find((x) => x.slug === options.template);
          if (!t) {
            throw new Error(
              `No template "${options.template}". One of: ${templates.map((x) => x.slug).join(', ')}`,
            );
          }
          base = { ...t };
        }
        const input = { ...base, ...definitionFields(options, cmd), workspaceId };
        const missing = (['name', 'cadenceRule', 'timezone', 'startsOn'] as const).filter(
          (k) => input[k] === undefined,
        );
        if (missing.length > 0) {
          const flags: Record<string, string> = {
            name: '--name',
            cadenceRule: '--cadence',
            timezone: '--timezone',
            startsOn: '--starts-on',
          };
          throw new Error(`Missing ${missing.map((k) => flags[k]).join(', ')}.`);
        }
        const result = await client.ceremonies.create(input as CeremonyCreateInput);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else outputCeremonyWritePretty(result, 'created');
      } catch (error) {
        handleError(error, useJson);
      }
    },
  );

  const update = addDefinitionOptions(
    ceremonies
      .command('update <ceremony>')
      .description(
        'Edit a ceremony (id, slug or URL). Only the flags you pass change. Changing the cadence reschedules future unattached occurrences.',
      )
      .option('--workspace <slug|id>', 'Workspace (not needed when you pass the URL)')
      .option('--active', 'Re-activate a retired ceremony')
      .option('--inactive', 'Retire the ceremony (stops scheduling)'),
  );
  update.action(
    async (
      value: string,
      options: DefinitionOptions & { workspace?: string; active?: boolean; inactive?: boolean },
      cmd: Command,
    ) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        if (options.active && options.inactive) throw new Error('Pass --active or --inactive, not both.');
        const client = getClient();
        const ref = parseCeremonyRef(value);
        const workspaceId = await workspaceFor(client, ref, options.workspace);
        const id = await resolveCeremonyId(client, workspaceId, ref.ceremonyId ?? ref.id);
        const input: CeremonyUpdateInput = {
          ...definitionFields(options, cmd),
          workspaceId,
          id,
          ...(options.active ? { isActive: true } : options.inactive ? { isActive: false } : {}),
        };
        if (Object.keys(input).length === 2) {
          throw new Error('Nothing to update — pass at least one field flag.');
        }
        const result = await client.ceremonies.update(input);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else outputCeremonyWritePretty(result, 'updated');
      } catch (error) {
        handleError(error, useJson);
      }
    },
  );

  ceremonies
    .command('import <file>')
    .description(
      'Upsert ceremonies from a JSON array keyed by slug ("-" = stdin). People by name/email via ownerName / participantNames. Workspace owner/admin only.',
    )
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .option('--timezone <iana>', 'Default zone for definitions without one')
    .option('--starts-on <date>', 'Default anchor date for definitions without one')
    .action(
      async (
        file: string,
        options: { workspace?: string; timezone?: string; startsOn?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const raw = readText(undefined, file);
          const parsed: unknown = JSON.parse(raw ?? '');
          if (!Array.isArray(parsed)) throw new Error('The import file must hold a JSON array of definitions.');
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const results = await client.ceremonies.importDefinitions({
            workspaceId,
            definitions: parsed as CeremonyImportDefinition[],
            timezone: options.timezone,
            startsOn: parseDate(options.startsOn),
          });
          if (useJson) {
            console.log(JSON.stringify({ results, total: results.length }, null, 2));
          } else {
            for (const r of results) {
              console.log(
                `✓ ${r.slug} ${r.action} (${r.occurrencesCreated} occurrence${r.occurrencesCreated === 1 ? '' : 's'} scheduled)`,
              );
              if (r.unresolved.length > 0) {
                console.log(chalk.yellow(`    Unresolved people: ${r.unresolved.join(', ')}`));
              }
            }
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  ceremonies
    .command('backfill')
    .description(
      'Attach unattached recorded meetings to occurrences by alias. Dry run unless --apply (a dry run still schedules any missing past occurrences). Workspace owner/admin only.',
    )
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .option('--apply', 'Write the attachments (default is a dry-run report)')
    .action(async (options: { workspace?: string; apply?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const result = await client.ceremonies.backfillAttachments(workspaceId, {
          dryRun: !options.apply,
        });
        if (useJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(
            chalk.bold(
              `\n${result.dryRun ? 'Dry run' : 'Applied'}: ${result.matched} of ${result.scanned} meetings matched`,
            ),
          );
          for (const row of result.rows) {
            const target = row.occurrenceId
              ? chalk.green(`→ ${row.ceremonyName} ${row.scheduledStart ? new Date(row.scheduledStart).toLocaleString() : ''}`)
              : chalk.gray(`— ${row.reason}`);
            console.log(`  ${row.title ?? row.meetingId} ${target}`);
          }
          if (result.dryRun && result.matched > 0) {
            console.log(chalk.gray('\nRe-run with --apply to write these attachments.'));
          }
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  ceremonies.addCommand(createOccurrencesCommand());

  return ceremonies;
}

import { Command } from 'commander';
import chalk from 'chalk';
import type {
  DecisionCreateInput,
  DecisionDeciderInput,
  DecisionEvidenceTurn,
  DecisionListRow,
  DecisionSource,
  DecisionStatus,
} from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { readText, parseDate } from '../utils/input.js';
import { resolveProductId, resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputDecisionJson,
  outputDecisionPretty,
  outputDecisionsJson,
  outputDecisionsPretty,
  outputDecisionBatchJson,
  outputDecisionBatchPretty,
  type BatchDecisionResult,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const STATUSES: DecisionStatus[] = [
  'OPEN',
  'PROPOSED',
  'ACCEPTED',
  'SUPERSEDED',
  'DEPRECATED',
];
const SOURCES: DecisionSource[] = ['MEETING', 'MANUAL', 'AGENT'];

/**
 * The whole point of this command group, and the thing nobody guesses: there
 * is no separate "open question" model. An open question is a decision whose
 * status is OPEN, and that is what the meeting page's Open questions panel
 * reads. Repeated in `--help` output because the schema comment is otherwise
 * the only place it is written down.
 */
const OPEN_QUESTION_NOTE =
  'An OPEN QUESTION is a decision with --status OPEN — there is no separate model, and that is exactly what a meeting\'s "Open questions" panel shows.';

function parseStatus(value: string): DecisionStatus {
  const upper = value.toUpperCase() as DecisionStatus;
  if (!STATUSES.includes(upper)) {
    throw new Error(
      `Invalid status "${value}". Use one of: ${STATUSES.join(', ')}. ${OPEN_QUESTION_NOTE}`,
    );
  }
  return upper;
}

function parseSource(value: string): DecisionSource {
  const upper = value.toUpperCase() as DecisionSource;
  if (!SOURCES.includes(upper)) {
    throw new Error(
      `Invalid source "${value}". Use one of: ${SOURCES.join(', ')}.`,
    );
  }
  return upper;
}

/**
 * `"Ada Lovelace <ada@example.com>"`, a bare name, or a bare email. The server
 * requires a name, so an email-only decider is named by its address.
 */
export function parseDecider(spec: string): DecisionDeciderInput {
  const angled = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(spec);
  if (angled) {
    const name = angled[1]?.trim() ?? '';
    const email = angled[2]!.trim();
    return { name: name === '' ? email : name, email };
  }
  const bare = spec.trim();
  if (bare === '') {
    throw new Error('Empty --decider. Use "Name <email>", a name, or an email.');
  }
  if (bare.includes('@') && !bare.includes(' ')) {
    return { name: bare, email: bare };
  }
  return { name: bare };
}

/** Evidence is a JSON array of `{turnIndex, speaker?, startTime?, text}`. */
export function parseEvidence(raw: string): DecisionEvidenceTurn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Evidence must be JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      'Evidence must be a JSON array of {turnIndex, speaker?, startTime?, text} objects.',
    );
  }
  return parsed.map((turn, i) => {
    if (typeof turn !== 'object' || turn === null) {
      throw new Error(`Evidence[${i}] is not an object.`);
    }
    const t = turn as Record<string, unknown>;
    if (typeof t.turnIndex !== 'number' || typeof t.text !== 'string') {
      throw new Error(
        `Evidence[${i}] needs a numeric "turnIndex" and a string "text".`,
      );
    }
    return {
      turnIndex: t.turnIndex,
      speaker: typeof t.speaker === 'string' ? t.speaker : null,
      startTime: typeof t.startTime === 'number' ? t.startTime : null,
      text: t.text,
    };
  });
}

/**
 * `--product` takes a slug or CUID, plus the literal `workspace` that the
 * list filter uses for "decisions with no product".
 */
async function resolveProductFilter(
  client: ReturnType<typeof getClient>,
  workspaceId: string,
  value: string | undefined,
): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (value === 'workspace') return 'workspace';
  return await resolveProductId(client, workspaceId, value);
}

function parsePositiveInt(v: string | undefined, flag: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got "${v}".`);
  }
  return n;
}

function parseNullableString(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === 'null' ? null : v;
}

function parseNullableInt(v: string | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === 'null') return null;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Expected a number, got "${v}".`);
  return n;
}

/** One entry in a `--from-file` batch: the create input, in JSON. */
interface BatchItem {
  statement?: unknown;
  body?: unknown;
  status?: unknown;
  source?: unknown;
  /** Alias for `transcriptionSessionId` — the motivating case. */
  meeting?: unknown;
  transcriptionSessionId?: unknown;
  productId?: unknown;
  projectId?: unknown;
  goalId?: unknown;
  keyResultId?: unknown;
  occurrenceId?: unknown;
  decidedAt?: unknown;
  ownerId?: unknown;
  deciders?: unknown;
  evidence?: unknown;
}

/** Every key a `--from-file` entry may carry; anything else is a typo. */
const BATCH_ITEM_KEYS = new Set<keyof BatchItem>([
  'statement',
  'body',
  'status',
  'source',
  'meeting',
  'transcriptionSessionId',
  'productId',
  'projectId',
  'goalId',
  'keyResultId',
  'occurrenceId',
  'decidedAt',
  'ownerId',
  'deciders',
  'evidence',
]) as Set<string>;

export function parseBatchFile(raw: string): BatchItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `--from-file must be JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const items =
    Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' &&
          parsed !== null &&
          Array.isArray((parsed as { decisions?: unknown }).decisions)
        ? ((parsed as { decisions: unknown[] }).decisions)
        : null;
  if (!items) {
    throw new Error(
      '--from-file must contain a JSON array of decisions, or {"decisions": [...]}.',
    );
  }
  if (items.length === 0) {
    throw new Error('--from-file contained no decisions.');
  }
  return items.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Decision[${i}] is not an object.`);
    }
    const entry = item as BatchItem;
    if (typeof entry.statement !== 'string' || entry.statement.trim() === '') {
      throw new Error(`Decision[${i}] needs a non-empty "statement".`);
    }
    // These files are usually generated. A key this reader doesn't know is a
    // typo or a wrong field name, and dropping it silently would file the
    // decision without the data its author meant to attach.
    const unknown = Object.keys(entry).filter(
      (key) => !BATCH_ITEM_KEYS.has(key),
    );
    if (unknown.length > 0) {
      throw new Error(
        `Decision[${i}] has unknown field(s): ${unknown.join(', ')}. Accepted: ${[...BATCH_ITEM_KEYS].join(', ')}.`,
      );
    }
    if (entry.goalId !== undefined && typeof entry.goalId !== 'number') {
      throw new Error(`Decision[${i}].goalId must be a number, not a string.`);
    }
    return entry;
  });
}

/** Deciders in a batch entry: `"Name <email>"` strings or objects. */
function batchDeciders(value: unknown, index: number): DecisionDeciderInput[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Decision[${index}].deciders must be an array.`);
  }
  return value.map((d) => {
    if (typeof d === 'string') return parseDecider(d);
    if (typeof d === 'object' && d !== null && typeof (d as { name?: unknown }).name === 'string') {
      const obj = d as { name: string; email?: unknown; userId?: unknown };
      return {
        name: obj.name,
        email: typeof obj.email === 'string' ? obj.email : null,
        userId: typeof obj.userId === 'string' ? obj.userId : null,
      };
    }
    throw new Error(
      `Decision[${index}].deciders entries must be "Name <email>" strings or {name, email?} objects.`,
    );
  });
}

export function createDecisionsCommand(): Command {
  const decisions = new Command('decisions').description(
    [
      'Log and manage decisions and open questions (the workspace Decision Log).',
      '',
      OPEN_QUESTION_NOTE,
      '',
      'Statuses: OPEN (an open question) · PROPOSED · ACCEPTED · SUPERSEDED · DEPRECATED.',
      'SUPERSEDED and DEPRECATED are reached with "decisions status", never at creation.',
    ].join('\n'),
  );

  decisions
    .command('list')
    .description(
      `List decisions, newest decided first. Pass --status OPEN for open questions only. ${OPEN_QUESTION_NOTE}`,
    )
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .option(
      '--meeting <id>',
      "One meeting's decisions and open questions (includes drafts if you can edit it)",
    )
    .option(
      '--status <status>',
      'Filter by status (repeatable): OPEN, PROPOSED, ACCEPTED, SUPERSEDED, DEPRECATED',
      (value: string, previous: DecisionStatus[]) => [...previous, parseStatus(value)],
      [] as DecisionStatus[],
    )
    .option(
      '--source <source>',
      'Filter by source (repeatable): MEETING, MANUAL, AGENT',
      (value: string, previous: DecisionSource[]) => [...previous, parseSource(value)],
      [] as DecisionSource[],
    )
    .option('--product <slug|id>', 'Filter by product, or "workspace" for decisions with no product')
    .option('--include-workspace-wide', 'With --product: also include decisions that have no product')
    .option('--project <id>', 'Filter by project CUID')
    .option('--search <text>', 'Free-text over statement and body')
    .option('--number <n>', 'One decision by its workspace sequence number (D-0003 is 3)')
    .option('--limit <n>', 'Cap the rows returned (1-500)')
    .option('--adr <id>', 'Decisions formalised as this ADR document')
    .action(
      async (
        options: {
          workspace?: string;
          meeting?: string;
          status: DecisionStatus[];
          source: DecisionSource[];
          product?: string;
          includeWorkspaceWide?: boolean;
          project?: string;
          search?: string;
          number?: string;
          limit?: string;
          adr?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();

          // A meeting resolves its own workspace, so this path works even
          // without a default workspace configured.
          if (options.meeting) {
            const result = await client.decisions.listForMeeting(options.meeting);
            let rows: DecisionListRow[] = result.decisions;
            if (options.status.length > 0) {
              rows = rows.filter((d) => options.status.includes(d.status));
            }
            if (options.source.length > 0) {
              rows = rows.filter((d) => options.source.includes(d.source));
            }
            if (useJson) {
              outputDecisionsJson(rows, {
                meetingId: options.meeting,
                workspaceId: result.workspaceId,
                canLogDecision: result.canLogDecision,
              });
            } else {
              outputDecisionsPretty(rows);
              if (!result.canLogDecision) {
                console.log(
                  chalk.yellow(
                    'You cannot log decisions on this meeting (no edit access, or it has no workspace).',
                  ),
                );
              }
            }
            return;
          }

          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          // `listForAdr` is its own query, not a filter on the log — running
          // the unbounded list first and discarding it is a wasted round trip
          // over every decision the caller can see.
          const rows = options.adr
            ? await client.decisions.listForAdr(workspaceId, options.adr)
            : await client.decisions.list({
                workspaceId,
                statuses: options.status.length > 0 ? options.status : undefined,
                sources: options.source.length > 0 ? options.source : undefined,
                productId: await resolveProductFilter(client, workspaceId, options.product),
                includeWorkspaceWide: options.includeWorkspaceWide,
                projectId: options.project,
                search: options.search,
                number: parsePositiveInt(options.number, '--number'),
                limit: parsePositiveInt(options.limit, '--limit'),
              });
          if (useJson) outputDecisionsJson(rows, { workspaceId });
          else outputDecisionsPretty(rows);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  decisions
    .command('get <id>')
    .description('Show one decision in full: body, evidence, deciders, chain and links')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .action(async (id: string, options: { workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const decision = await client.decisions.get(workspaceId, id);
        if (useJson) outputDecisionJson(decision);
        else outputDecisionPretty(decision);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  decisions
    .command('create')
    .description(
      [
        'Log a decision, or an open question with --status OPEN.',
        OPEN_QUESTION_NOTE,
        'Bodies are Markdown: use --body-file <path> (or - for stdin) rather than a shell argument.',
        'Bulk: --from-file <path|-> takes a JSON array of decisions; the other flags become its defaults.',
      ].join(' '),
    )
    .option('-s, --statement <text>', 'The decision, or the open question (max 500 chars)')
    .option('-b, --body <markdown>', 'Markdown detail: context, alternatives, consequences')
    .option('--body-file <path>', 'Read the body from a file ("-" = stdin)')
    .option('--status <status>', 'OPEN (open question), PROPOSED (default) or ACCEPTED')
    .option('--source <source>', 'MEETING, MANUAL or AGENT')
    .option('--meeting <id>', 'Meeting (transcriptionSessionId) this came out of — needs edit access to it')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .option('--product <slug|id>', 'Link to a product')
    .option('--project <id>', 'Link to a project CUID')
    .option('--goal <id>', 'Link to a goal (integer id)')
    .option('--key-result <id>', 'Link to a key result CUID')
    .option('--occurrence <id>', 'Link to a ceremony occurrence CUID')
    .option('--decided-at <iso>', 'When it was decided (e.g. 2026-09-10T14:00)')
    .option('--owner <userId>', 'Owner user ID')
    .option(
      '--decider <"Name <email>">',
      'Someone who made the decision (repeatable); external people need no account',
      (value: string, previous: DecisionDeciderInput[]) => [...previous, parseDecider(value)],
      [] as DecisionDeciderInput[],
    )
    .option(
      '--evidence-file <path>',
      'JSON array of {turnIndex, text} transcript quotes ("-" = stdin). Needs --meeting: the server checks every quote against that transcript and silently drops the ones that do not match.',
    )
    .option('--from-file <path>', 'Bulk create from a JSON array of decisions ("-" = stdin)')
    .action(
      async (
        options: {
          statement?: string;
          body?: string;
          bodyFile?: string;
          status?: string;
          source?: string;
          meeting?: string;
          workspace?: string;
          product?: string;
          project?: string;
          goal?: string;
          keyResult?: string;
          occurrence?: string;
          decidedAt?: string;
          owner?: string;
          decider: DecisionDeciderInput[];
          evidenceFile?: string;
          fromFile?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!options.statement && !options.fromFile) {
            throw new Error(
              'Pass --statement <text>, or --from-file <path|-> for a bulk create.',
            );
          }
          if (options.statement && options.fromFile) {
            throw new Error(
              '--statement and --from-file are alternatives: the file carries the statements.',
            );
          }

          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId = options.product
            ? await resolveProductId(client, workspaceId, options.product)
            : undefined;
          const status = options.status ? parseStatus(options.status) : undefined;
          const source = options.source ? parseSource(options.source) : undefined;
          const decidedAt = parseDate(options.decidedAt);
          const goalId = options.goal ? Number.parseInt(options.goal, 10) : undefined;
          if (goalId !== undefined && Number.isNaN(goalId)) {
            throw new Error(`--goal must be an integer id, got "${options.goal}".`);
          }

          // Shared scope for both paths; per-item values override these.
          const defaults = {
            workspaceId,
            status,
            source,
            transcriptionSessionId: options.meeting,
            productId,
            projectId: options.project,
            goalId,
            keyResultId: options.keyResult,
            occurrenceId: options.occurrence,
            decidedAt,
            ownerId: options.owner,
            deciders: options.decider.length > 0 ? options.decider : undefined,
          };

          if (options.fromFile) {
            // Body and evidence are per-decision content, not scope that can
            // be shared across 40 rows. Silently ignoring them would file the
            // batch with the wrong bodies and say nothing.
            const perEntryOnly = [
              options.body !== undefined ? '--body' : null,
              options.bodyFile !== undefined ? '--body-file' : null,
              options.evidenceFile !== undefined ? '--evidence-file' : null,
            ].filter((flag): flag is string => flag !== null);
            if (perEntryOnly.length > 0) {
              throw new Error(
                `${perEntryOnly.join(', ')} ${perEntryOnly.length === 1 ? 'is' : 'are'} per-decision content — put "body" and "evidence" on each entry in --from-file instead.`,
              );
            }
            const items = parseBatchFile(readText(undefined, options.fromFile)!);
            const results: BatchDecisionResult[] = [];
            // Sequential on purpose: decisions take their workspace sequence
            // number on write, and a partial failure has to name which entry
            // failed rather than collapsing into one rejected batch.
            for (const [index, item] of items.entries()) {
              const statement = String(item.statement);
              try {
                const input: DecisionCreateInput = {
                  ...defaults,
                  statement,
                  body: typeof item.body === 'string' ? item.body : undefined,
                  status:
                    item.status !== undefined
                      ? parseStatus(String(item.status))
                      : defaults.status,
                  source:
                    item.source !== undefined
                      ? parseSource(String(item.source))
                      : defaults.source,
                  transcriptionSessionId:
                    typeof item.transcriptionSessionId === 'string'
                      ? item.transcriptionSessionId
                      : typeof item.meeting === 'string'
                        ? item.meeting
                        : defaults.transcriptionSessionId,
                  productId:
                    typeof item.productId === 'string' ? item.productId : defaults.productId,
                  projectId:
                    typeof item.projectId === 'string' ? item.projectId : defaults.projectId,
                  goalId: typeof item.goalId === 'number' ? item.goalId : defaults.goalId,
                  keyResultId:
                    typeof item.keyResultId === 'string'
                      ? item.keyResultId
                      : defaults.keyResultId,
                  occurrenceId:
                    typeof item.occurrenceId === 'string'
                      ? item.occurrenceId
                      : defaults.occurrenceId,
                  decidedAt:
                    typeof item.decidedAt === 'string'
                      ? parseDate(item.decidedAt)
                      : defaults.decidedAt,
                  ownerId: typeof item.ownerId === 'string' ? item.ownerId : defaults.ownerId,
                  deciders: batchDeciders(item.deciders, index) ?? defaults.deciders,
                  evidence:
                    item.evidence === undefined
                      ? undefined
                      : parseEvidence(JSON.stringify(item.evidence)),
                };
                if (input.evidence && !input.transcriptionSessionId) {
                  throw new Error(
                    'Evidence is quotes from a meeting transcript, so this entry needs a "meeting" (or the --meeting flag).',
                  );
                }
                const decision = await client.decisions.create(input);
                results.push({ index, success: true, decision, statement });
              } catch (error) {
                results.push({
                  index,
                  success: false,
                  statement,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
            // Anything short of "everything was logged" is a non-zero exit,
            // so a pipeline can't mistake a partial write for success.
            if (results.some((r) => !r.success)) process.exitCode = 1;
            if (useJson) outputDecisionBatchJson(results);
            else outputDecisionBatchPretty(results);
            return;
          }

          const evidenceRaw = readText(undefined, options.evidenceFile);
          if (evidenceRaw !== undefined && !options.meeting) {
            throw new Error(
              'Evidence is quotes from a meeting transcript, so --evidence-file needs --meeting <id>.',
            );
          }
          const decision = await client.decisions.create({
            ...defaults,
            statement: options.statement!,
            body: readText(options.body, options.bodyFile),
            deciders: options.decider.length > 0 ? options.decider : undefined,
            evidence: evidenceRaw === undefined ? undefined : parseEvidence(evidenceRaw),
          });
          if (useJson) outputDecisionJson(decision);
          else {
            console.log(
              `\n✓ ${decision.status === 'OPEN' ? 'Open question' : 'Decision'} logged`,
            );
            outputDecisionPretty(decision);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  decisions
    .command('update')
    .description(
      'Update a decision\'s content and scope; only the fields you pass are written. Status changes go through "decisions status".',
    )
    .requiredOption('--id <id>', 'Decision CUID')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .option('-s, --statement <text>', 'New statement')
    .option('-b, --body <markdown>', 'New Markdown body (or "null" to clear)')
    .option('--body-file <path>', 'Read the new body from a file ("-" = stdin)')
    .option('--decided-at <iso>', 'When it was decided (or "null" to clear)')
    .option('--owner <userId>', 'Owner user ID (or "null" to clear)')
    .option('--product <slug|id>', 'Product (or "null" to detach)')
    .option('--project <id>', 'Project CUID (or "null" to detach)')
    .option('--goal <id>', 'Goal integer id (or "null" to detach)')
    .option('--key-result <id>', 'Key result CUID (or "null" to detach)')
    .option('--adr <id>', 'ADR document CUID (or "null" to detach)')
    .action(
      async (
        options: {
          id: string;
          workspace?: string;
          statement?: string;
          body?: string;
          bodyFile?: string;
          decidedAt?: string;
          owner?: string;
          product?: string;
          project?: string;
          goal?: string;
          keyResult?: string;
          adr?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const body =
            options.body === 'null' ? null : readText(options.body, options.bodyFile);
          const patch = {
            statement: options.statement,
            body,
            decidedAt:
              options.decidedAt === 'null' ? null : parseDate(options.decidedAt),
            ownerId: parseNullableString(options.owner),
            projectId: parseNullableString(options.project),
            goalId: parseNullableInt(options.goal),
            keyResultId: parseNullableString(options.keyResult),
            adrDocumentId: parseNullableString(options.adr),
          };
          if (
            options.product === undefined &&
            Object.values(patch).every((v) => v === undefined)
          ) {
            throw new Error(
              'Nothing to update. Pass at least one of --statement, --body, --body-file, --decided-at, --owner, --product, --project, --goal, --key-result, --adr.',
            );
          }
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId =
            options.product === undefined
              ? undefined
              : options.product === 'null'
                ? null
                : await resolveProductId(client, workspaceId, options.product);
          const decision = await client.decisions.update({
            workspaceId,
            decisionId: options.id,
            ...patch,
            productId,
          });
          if (useJson) outputDecisionJson(decision);
          else {
            console.log('\n✓ Decision updated');
            outputDecisionPretty(decision);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  decisions
    .command('status')
    .description(
      'Move a decision through its lifecycle — including answering an open question by moving it from OPEN to ACCEPTED.',
    )
    .requiredOption('--id <id>', 'Decision CUID')
    .requiredOption(
      '--status <status>',
      'OPEN, PROPOSED, ACCEPTED, SUPERSEDED or DEPRECATED',
    )
    .option('--superseded-by <id>', 'The decision that replaced this one (with --status SUPERSEDED)')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .action(
      async (
        options: {
          id: string;
          status: string;
          supersededBy?: string;
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = parseStatus(options.status);
          if (status === 'SUPERSEDED' && !options.supersededBy) {
            throw new Error(
              '--status SUPERSEDED needs --superseded-by <id>: the decision that replaced this one.',
            );
          }
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const decision = await client.decisions.setStatus({
            workspaceId,
            decisionId: options.id,
            status,
            supersededById: options.supersededBy,
          });
          if (useJson) outputDecisionJson(decision);
          else {
            console.log(`\n✓ Decision is now ${decision.status}`);
            outputDecisionPretty(decision);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  decisions
    .command('link')
    .description('Record what implements a decision: a ticket or a feature. Idempotent.')
    .requiredOption('--id <id>', 'Decision CUID')
    .option('--ticket <id>', 'Ticket CUID')
    .option('--feature <id>', 'Feature CUID')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .action(
      async (
        options: { id: string; ticket?: string; feature?: string; workspace?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          if (!options.ticket && !options.feature) {
            throw new Error('Pass --ticket <id> or --feature <id>.');
          }
          if (options.ticket && options.feature) {
            throw new Error('Pass one of --ticket or --feature, not both.');
          }
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const link = options.ticket
            ? await client.decisions.linkTicket(workspaceId, options.id, options.ticket)
            : await client.decisions.linkFeature(workspaceId, options.id, options.feature!);
          if (useJson) console.log(JSON.stringify(link, null, 2));
          else {
            console.log(`✓ Linked ${chalk.gray(`(link id ${link.id})`)}`);
            console.log(
              chalk.gray('  Remove it with: exponential decisions unlink --link ' + link.id),
            );
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  decisions
    .command('unlink')
    .description(
      'Remove one "implemented by" link. Takes the LINK id (shown by "decisions get"), not the ticket or feature id.',
    )
    .requiredOption('--link <id>', 'DecisionLink CUID')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .action(async (options: { link: string; workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        await client.decisions.unlink(workspaceId, options.link);
        if (useJson) console.log(JSON.stringify({ deleted: true, linkId: options.link }, null, 2));
        else console.log('✓ Link removed');
      } catch (error) {
        handleError(error, useJson);
      }
    });

  const drafts = new Command('draft').description(
    'Review decisions an agent proposed but nobody has confirmed yet (visible only on their source meeting)',
  );

  drafts
    .command('extract')
    .description(
      "Propose draft decisions from a meeting's notes and transcript, for someone to confirm. Idempotent: existing drafts are returned rather than regenerated, and a meeting that already has confirmed decisions is left alone.",
    )
    .requiredOption('--meeting <id>', 'Meeting CUID (transcriptionSessionId)')
    .action(async (options: { meeting: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const result = await client.decisions.extractDrafts(options.meeting);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else {
          if (result.alreadyPublished) {
            console.log(
              chalk.gray('This meeting already has confirmed decisions — nothing was extracted.'),
            );
          } else if (result.alreadyDrafted) {
            console.log(chalk.gray('Returning the drafts this meeting already had.'));
          }
          console.log(
            `✓ ${result.draftCount} draft${result.draftCount === 1 ? '' : 's'} awaiting review (${result.draftsCreated} new)`,
          );
          if (result.discardedWithoutEvidence > 0) {
            console.log(
              chalk.gray(
                `  ${result.discardedWithoutEvidence} candidate(s) dropped — no transcript turn supported them.`,
              ),
            );
          }
          for (const message of result.errors) console.log(chalk.yellow(`  ${message}`));
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  drafts
    .command('confirm')
    .description('Publish a draft decision into the log')
    .requiredOption('--id <id>', 'Decision CUID')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .action(async (options: { id: string; workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const decision = await client.decisions.confirmDraft(workspaceId, options.id);
        if (useJson) outputDecisionJson(decision);
        else {
          console.log('\n✓ Draft confirmed');
          outputDecisionPretty(decision);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  drafts
    .command('reject')
    .description(
      'Reject a draft. A confirmed decision is never rejected — deprecate or supersede it with "decisions status".',
    )
    .requiredOption('--id <id>', 'Decision CUID')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .action(async (options: { id: string; workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const result = await client.decisions.rejectDraft(workspaceId, options.id);
        if (useJson) console.log(JSON.stringify(result, null, 2));
        else console.log('✓ Draft rejected');
      } catch (error) {
        handleError(error, useJson);
      }
    });

  drafts
    .command('delete')
    .description(
      'Permanently delete a draft or rejected decision. Confirmed decisions are never deleted.',
    )
    .requiredOption('--id <id>', 'Decision CUID')
    .option('--workspace <slug|id>', 'Workspace (defaults to your default workspace)')
    .action(async (options: { id: string; workspace?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const workspaceId = await resolveWorkspaceId(client, options.workspace);
        const result = await client.decisions.deleteDraft(workspaceId, options.id);
        if (useJson) console.log(JSON.stringify({ deleted: true, ...result }, null, 2));
        else console.log('✓ Draft deleted');
      } catch (error) {
        handleError(error, useJson);
      }
    });

  decisions.addCommand(drafts);

  return decisions;
}

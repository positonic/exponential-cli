import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { readText, parseDate } from '../utils/input.js';
import { resolveWorkspaceId } from '../utils/resolve.js';
import {
  shouldUseJson,
  outputMeetingJson,
  outputMeetingPretty,
  outputMeetingsJson,
  outputMeetingsPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

export function createMeetingsCommand(): Command {
  const meetings = new Command('meetings').description(
    'Manage meetings and their notes (recorded, imported, or manually created)',
  );

  meetings
    .command('list')
    .description(
      'List meetings you can see (owned, attended, or shared via project/workspace). JSON rows carry hasNotes/hasSummary/hasTranscript flags instead of the bodies — use "get" for content.',
    )
    .option('--workspace <slug|id>', 'Restrict to one workspace')
    .option('--mine', 'Only meetings you own or attended')
    .option('--archived', 'Include archived meetings')
    .action(
      async (
        options: { workspace?: string; mine?: boolean; archived?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const workspaceId = options.workspace
            ? await resolveWorkspaceId(client, options.workspace)
            : undefined;
          const list = await client.meetings.list({
            workspaceId,
            includeArchived: options.archived,
            meetingType: options.mine ? 'mine' : undefined,
          });
          if (useJson) outputMeetingsJson(list);
          else outputMeetingsPretty(list);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  meetings
    .command('get <id>')
    .description('Get a meeting: details, summary, and notes')
    .option('--transcript', 'Also print the raw transcript (pretty mode; JSON always includes it)')
    .action(
      async (id: string, options: { transcript?: boolean }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const meeting = await client.meetings.get(id);
          if (useJson) outputMeetingJson(meeting);
          else outputMeetingPretty(meeting, { transcript: options.transcript });
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  meetings
    .command('create')
    .description(
      'Create a meeting manually. Transcript: --transcript text, --transcript-file <path>, or --transcript-file - for stdin.',
    )
    .requiredOption('-t, --title <title>', 'Meeting title')
    .option('--transcript <text>', 'Transcript text (required by the API)')
    .option('--transcript-file <path>', 'Read the transcript from a file ("-" = stdin)')
    .option('--notes <markdown>', 'Meeting notes')
    .option('--notes-file <path>', 'Read the notes from a file ("-" = stdin)')
    .option('--description <text>', 'Short description')
    .option('--date <iso>', 'When the meeting occurred (e.g. 2026-08-25T14:00; a bare date is local midnight)')
    .option('--project <id>', 'Link to a project (the meeting inherits its workspace)')
    .option('--workspace <slug|id>', 'Workspace (omit for a personal meeting)')
    .action(
      async (
        options: {
          title: string;
          transcript?: string;
          transcriptFile?: string;
          notes?: string;
          notesFile?: string;
          description?: string;
          date?: string;
          project?: string;
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const transcription = readText(options.transcript, options.transcriptFile);
          if (transcription === undefined) {
            throw new Error(
              'A transcript is required: pass --transcript <text> or --transcript-file <path|->.',
            );
          }
          if (transcription.trim() === '') {
            throw new Error('The transcript is empty. The API requires a non-empty transcript.');
          }
          const workspaceId = options.workspace
            ? await resolveWorkspaceId(client, options.workspace)
            : undefined;
          const meeting = await client.meetings.create({
            title: options.title,
            transcription,
            notes: readText(options.notes, options.notesFile),
            description: options.description,
            meetingDate: parseDate(options.date),
            projectId: options.project,
            workspaceId,
          });
          if (useJson) outputMeetingJson(meeting);
          else {
            console.log('\n✓ Meeting created');
            outputMeetingPretty(meeting);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  meetings
    .command('update')
    .description(
      'Update a meeting; only the fields you pass are written. Title and other fields are two API calls — on a mid-flight failure the title may already be saved.',
    )
    .requiredOption('--id <id>', 'Meeting CUID')
    .option('-t, --title <title>', 'New title')
    .option('--notes <markdown>', 'Replace the meeting notes')
    .option('--notes-file <path>', 'Read the new notes from a file ("-" = stdin)')
    .option('--summary <text>', 'Replace the summary')
    .option('--description <text>', 'Replace the description')
    .option('--date <iso>', 'When the meeting occurred')
    .action(
      async (
        options: {
          id: string;
          title?: string;
          notes?: string;
          notesFile?: string;
          summary?: string;
          description?: string;
          date?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const notes = readText(options.notes, options.notesFile);
          if (
            options.title === undefined &&
            notes === undefined &&
            options.summary === undefined &&
            options.description === undefined &&
            options.date === undefined
          ) {
            throw new Error(
              'Nothing to update. Pass at least one of --title, --notes, --notes-file, --summary, --description, --date.',
            );
          }
          const client = getClient();
          const meeting = await client.meetings.update({
            id: options.id,
            title: options.title,
            notes,
            summary: options.summary,
            description: options.description,
            meetingDate: parseDate(options.date),
          });
          if (useJson) outputMeetingJson(meeting);
          else {
            console.log('\n✓ Meeting updated');
            outputMeetingPretty(meeting);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  meetings
    .command('delete [ids...]')
    .description(
      'Permanently delete meetings you own. Pass one or more ids, and/or --ids-file with whitespace-separated ids ("-" = stdin). Deleting more than one id requires --force. Exit 0 only when everything requested was deleted.',
    )
    .option('--ids-file <path>', 'Read whitespace-separated meeting ids from a file ("-" = stdin)')
    .option('--force', 'Confirm deleting more than one meeting in a single call')
    .action(
      async (
        idArgs: string[],
        options: { idsFile?: string; force?: boolean },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const fromFile = readText(undefined, options.idsFile);
          const ids = [
            ...new Set([
              ...idArgs,
              ...(fromFile ? fromFile.split(/\s+/) : []),
            ].filter((id) => id !== '')),
          ];
          if (ids.length === 0) {
            throw new Error(
              'Nothing to delete. Pass one or more meeting ids, or --ids-file <path|->.',
            );
          }
          // A mis-built pipe (unfiltered jq output, an error message, the
          // wrong file) must not turn into a silent no-op "success" — the
          // bulk mutation skips unknown ids without complaint.
          const malformed = ids.filter((id) => !/^[a-z][a-z0-9]{15,}$/i.test(id));
          if (malformed.length > 0) {
            throw new Error(
              `These don't look like meeting ids: ${malformed.slice(0, 5).join(', ')}${malformed.length > 5 ? ` (+${malformed.length - 5} more)` : ''}. Nothing was deleted.`,
            );
          }
          if (ids.length > 1 && !options.force) {
            throw new Error(
              `Refusing to delete ${ids.length} meetings without --force. Deletion is permanent.`,
            );
          }
          const client = getClient();
          let count: number;
          if (ids.length === 1) {
            // Single-id path gets precise errors (NOT_FOUND / FORBIDDEN)
            // instead of the bulk path's silent skip.
            await client.meetings.delete(ids[0]!);
            count = 1;
          } else {
            // Chunked so one oversized request can't fail wholesale with
            // zero deletions; counts are summed across chunks.
            count = 0;
            for (let i = 0; i < ids.length; i += 500) {
              const chunk = ids.slice(i, i + 500);
              count += (await client.meetings.deleteMany(chunk)).count;
            }
          }
          const skipped = ids.length - count;
          if (skipped > 0) {
            // Same contract as the single-id error path: anything short of
            // "everything requested was deleted" is a non-zero exit.
            process.exitCode = 1;
          }
          if (useJson) {
            console.log(
              JSON.stringify({ requested: ids.length, count, skipped }, null, 2),
            );
          } else {
            console.log(`✓ Deleted ${count} of ${ids.length} meeting${ids.length === 1 ? '' : 's'}`);
            if (skipped > 0) {
              console.log(
                chalk.yellow(
                  `${skipped} id(s) were skipped — not found, or not owned by you.`,
                ),
              );
            }
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  const notes = new Command('notes').description(
    "Read and write a meeting's notes",
  );

  notes
    .command('get <id>')
    .description(
      'Print the meeting notes as raw Markdown (safe to redirect to a file); pass --json for a {id, notes} envelope',
    )
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      try {
        const client = getClient();
        const body = await client.meetings.getNotes(id);
        if (globalOpts.json) {
          console.log(JSON.stringify({ id, notes: body }, null, 2));
        } else if (body !== null) {
          // Raw body even when piped — this output round-trips into
          // `notes set --file`, so it must never pick up a JSON envelope.
          process.stdout.write(body.endsWith('\n') ? body : `${body}\n`);
        } else if (process.stdout.isTTY) {
          console.log(chalk.gray('No notes yet.'));
        }
      } catch (error) {
        handleError(error, shouldUseJson(globalOpts.json, globalOpts.pretty));
      }
    });

  notes
    .command('set <id> [notes]')
    .description('Replace the meeting notes. Body: inline, --file <path>, or --file - for stdin.')
    .option('--file <path>', 'Read the notes from a file ("-" = stdin)')
    .action(
      async (
        id: string,
        inline: string | undefined,
        options: { file?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const body = readText(inline, options.file);
          if (body === undefined) {
            throw new Error('Pass the notes inline or via --file <path|->.');
          }
          const client = getClient();
          const meeting = await client.meetings.setNotes(id, body);
          if (useJson) outputMeetingJson(meeting);
          else console.log('✓ Notes saved');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  notes
    .command('append <id> [notes]')
    .description(
      'Append a block to the meeting notes (separated by a blank line). Read-modify-write: concurrent appends can lose one side.',
    )
    .option('--file <path>', 'Read the block from a file ("-" = stdin)')
    .action(
      async (
        id: string,
        inline: string | undefined,
        options: { file?: string },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const body = readText(inline, options.file);
          if (body === undefined) {
            throw new Error('Pass the notes inline or via --file <path|->.');
          }
          const client = getClient();
          const meeting = await client.meetings.appendNotes(id, body);
          if (useJson) outputMeetingJson(meeting);
          else console.log('✓ Notes appended');
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  meetings.addCommand(notes);

  return meetings;
}

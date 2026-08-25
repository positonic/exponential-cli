import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
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

/** Text from an inline value, a --*-file path, or "-" for stdin. */
function readText(inline?: string, file?: string): string | undefined {
  if (inline !== undefined) return inline;
  if (file === undefined) return undefined;
  if (file === '-') return readFileSync(0, 'utf-8');
  return readFileSync(file, 'utf-8');
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${value}". Use ISO format, e.g. 2026-08-25 or 2026-08-25T14:00.`);
  }
  return date;
}

export function createMeetingsCommand(): Command {
  const meetings = new Command('meetings').description(
    'Manage meetings and their notes (recorded, imported, or manually created)',
  );

  meetings
    .command('list')
    .description('List meetings you can see (owned, attended, or shared via project/workspace)')
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
    .option('--transcript', 'Also print the raw transcript')
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
    .option('--date <iso>', 'When the meeting occurred (e.g. 2026-08-25T14:00)')
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
          if (!transcription) {
            throw new Error(
              'A transcript is required: pass --transcript <text> or --transcript-file <path|->.',
            );
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
    .command('update <id>')
    .description('Update a meeting (only the fields you pass are written)')
    .option('-t, --title <title>', 'New title')
    .option('--notes <markdown>', 'Replace the meeting notes')
    .option('--notes-file <path>', 'Read the new notes from a file ("-" = stdin)')
    .option('--summary <text>', 'Replace the summary')
    .option('--description <text>', 'Replace the description')
    .option('--date <iso>', 'When the meeting occurred')
    .action(
      async (
        id: string,
        options: {
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
          const client = getClient();
          const meeting = await client.meetings.update({
            id,
            title: options.title,
            notes: readText(options.notes, options.notesFile),
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

  const notes = new Command('notes').description(
    'Read and write a meeting\'s notes',
  );

  notes
    .command('get <id>')
    .description('Print the meeting notes (raw Markdown, pipeable)')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const body = await client.meetings.getNotes(id);
        if (useJson) {
          console.log(JSON.stringify({ id, notes: body }, null, 2));
        } else if (body) {
          console.log(body);
        } else {
          console.log(chalk.gray('No notes yet.'));
        }
      } catch (error) {
        handleError(error, useJson);
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
    .description('Append a block to the meeting notes (separated by a blank line)')
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

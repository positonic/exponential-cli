import { Command } from 'commander';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import {
  shouldUseJson,
  outputContactJson,
  outputContactPretty,
  outputContactsJson,
  outputContactsPretty,
  outputInteractionJson,
  outputInteractionPretty,
} from '../utils/output.js';
import type { InteractionType, InteractionDirection } from 'exponential-sdk';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
  workspace?: string;
}

const VALID_INTERACTION_TYPES: InteractionType[] = [
  'EMAIL', 'TELEGRAM', 'PHONE_CALL', 'MEETING', 'NOTE', 'LINKEDIN', 'OTHER',
];

const VALID_INTERACTION_DIRECTIONS: InteractionDirection[] = ['INBOUND', 'OUTBOUND'];

export function createContactsCommand(): Command {
  const contacts = new Command('contacts')
    .description('Manage CRM contacts');

  contacts
    .command('list')
    .description('List contacts')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .option('--search <query>', 'Search by name or email')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--organization <id>', 'Filter by organization ID')
    .option('--limit <n>', 'Max results to return', parseInt)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (options: {
      workspace: string;
      search?: string;
      tags?: string;
      organization?: string;
      limit?: number;
      cursor?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const result = await client.contacts.list({
          workspaceId: options.workspace,
          search: options.search,
          tags: options.tags?.split(',').map(t => t.trim()),
          organizationId: options.organization,
          limit: options.limit,
          cursor: options.cursor,
        });

        if (useJson) {
          outputContactsJson(result.contacts, result.nextCursor);
        } else {
          outputContactsPretty(result.contacts);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  contacts
    .command('get')
    .description('Get a contact by ID')
    .argument('<id>', 'Contact ID')
    .option('--interactions', 'Include interaction history')
    .action(async (id: string, options: { interactions?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const contact = await client.contacts.get(id, {
          includeInteractions: options.interactions,
        });

        if (useJson) {
          outputContactJson(contact);
        } else {
          outputContactPretty(contact);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  contacts
    .command('create')
    .description('Create a new contact')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--email <email>', 'Email address')
    .option('--phone <phone>', 'Phone number')
    .option('--linkedin <url>', 'LinkedIn URL')
    .option('--telegram <handle>', 'Telegram handle')
    .option('--twitter <handle>', 'Twitter/X handle')
    .option('--github <handle>', 'GitHub username')
    .option('--bluesky <handle>', 'Bluesky handle')
    .option('--about <text>', 'About / bio')
    .option('--profile-type <type>', 'Profile type')
    .option('--skills <skills>', 'Skills (comma-separated)')
    .option('--tags <tags>', 'Tags (comma-separated)')
    .option('--organization <id>', 'Organization ID')
    .action(async (options: {
      workspace: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      linkedin?: string;
      telegram?: string;
      twitter?: string;
      github?: string;
      bluesky?: string;
      about?: string;
      profileType?: string;
      skills?: string;
      tags?: string;
      organization?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        const contact = await client.contacts.create({
          workspaceId: options.workspace,
          firstName: options.firstName,
          lastName: options.lastName,
          email: options.email,
          phone: options.phone,
          linkedIn: options.linkedin,
          telegram: options.telegram,
          twitter: options.twitter,
          github: options.github,
          bluesky: options.bluesky,
          about: options.about,
          profileType: options.profileType,
          skills: options.skills?.split(',').map(s => s.trim()),
          tags: options.tags?.split(',').map(t => t.trim()),
          organizationId: options.organization,
        });

        if (useJson) {
          outputContactJson(contact);
        } else {
          console.log('\n✓ Contact created successfully');
          outputContactPretty(contact);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  contacts
    .command('update')
    .description('Update an existing contact')
    .requiredOption('--id <id>', 'Contact ID')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--email <email>', 'Email (use "null" to clear)')
    .option('--phone <phone>', 'Phone (use "null" to clear)')
    .option('--linkedin <url>', 'LinkedIn URL (use "null" to clear)')
    .option('--telegram <handle>', 'Telegram handle (use "null" to clear)')
    .option('--twitter <handle>', 'Twitter/X handle (use "null" to clear)')
    .option('--github <handle>', 'GitHub username (use "null" to clear)')
    .option('--bluesky <handle>', 'Bluesky handle (use "null" to clear)')
    .option('--about <text>', 'About / bio')
    .option('--profile-type <type>', 'Profile type')
    .option('--skills <skills>', 'Skills (comma-separated)')
    .option('--tags <tags>', 'Tags (comma-separated)')
    .option('--organization <id>', 'Organization ID (use "null" to clear)')
    .action(async (options: {
      id: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      linkedin?: string;
      telegram?: string;
      twitter?: string;
      github?: string;
      bluesky?: string;
      about?: string;
      profileType?: string;
      skills?: string;
      tags?: string;
      organization?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      const nullable = (v?: string) => v === 'null' ? null : v;

      try {
        const client = getClient();
        const contact = await client.contacts.update({
          id: options.id,
          firstName: options.firstName,
          lastName: options.lastName,
          email: nullable(options.email),
          phone: nullable(options.phone),
          linkedIn: nullable(options.linkedin),
          telegram: nullable(options.telegram),
          twitter: nullable(options.twitter),
          github: nullable(options.github),
          bluesky: nullable(options.bluesky),
          about: options.about,
          profileType: options.profileType,
          skills: options.skills?.split(',').map(s => s.trim()),
          tags: options.tags?.split(',').map(t => t.trim()),
          organizationId: nullable(options.organization),
        });

        if (useJson) {
          outputContactJson(contact);
        } else {
          console.log('\n✓ Contact updated successfully');
          outputContactPretty(contact);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  contacts
    .command('delete')
    .description('Delete a contact')
    .argument('<id>', 'Contact ID')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        const client = getClient();
        await client.contacts.delete(id);

        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id }, null, 2));
        } else {
          console.log(`\n✓ Contact ${id} deleted`);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  contacts
    .command('add-interaction')
    .description('Add an interaction to a contact')
    .requiredOption('--contact <id>', 'Contact ID')
    .requiredOption('--type <type>', `Interaction type (${VALID_INTERACTION_TYPES.join(', ')})`)
    .requiredOption('--direction <dir>', `Direction (${VALID_INTERACTION_DIRECTIONS.join(', ')})`)
    .option('--subject <text>', 'Subject line')
    .option('--notes <text>', 'Notes')
    .action(async (options: {
      contact: string;
      type: string;
      direction: string;
      subject?: string;
      notes?: string;
    }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);

      try {
        if (!VALID_INTERACTION_TYPES.includes(options.type as InteractionType)) {
          throw new Error(`Invalid interaction type "${options.type}". Valid: ${VALID_INTERACTION_TYPES.join(', ')}`);
        }
        if (!VALID_INTERACTION_DIRECTIONS.includes(options.direction as InteractionDirection)) {
          throw new Error(`Invalid direction "${options.direction}". Valid: ${VALID_INTERACTION_DIRECTIONS.join(', ')}`);
        }

        const client = getClient();
        const interaction = await client.contacts.addInteraction({
          contactId: options.contact,
          type: options.type as InteractionType,
          direction: options.direction as InteractionDirection,
          subject: options.subject,
          notes: options.notes,
        });

        if (useJson) {
          outputInteractionJson(interaction);
        } else {
          console.log('\n✓ Interaction added');
          outputInteractionPretty(interaction);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  return contacts;
}

import { Command } from 'commander';
import type { TicketStatus, TicketType } from 'exponential-sdk';
import { getClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';
import { resolveProductId, resolveWorkspaceId } from '../utils/resolve.js';
import { resolveLabelIds } from './labels.js';
import {
  applyMentions,
  collectMention,
  MENTION_OPTION_DESCRIPTION,
} from '../utils/mentions.js';

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}
import {
  shouldUseJson,
  outputCommentJson,
  outputCommentPretty,
  outputCommentsJson,
  outputCommentsPretty,
  outputTicketJson,
  outputTicketPretty,
  outputTicketsJson,
  outputTicketsPretty,
  outputActionJson,
  outputActionPretty,
} from '../utils/output.js';

interface GlobalOptions {
  json?: boolean;
  pretty?: boolean;
}

const TICKET_STATUSES: TicketStatus[] = [
  'BACKLOG',
  'NEEDS_REFINEMENT',
  'READY_TO_PLAN',
  'COMMITTED',
  'IN_PROGRESS',
  'BLOCKED',
  'QA',
  'DONE',
  'DEPLOYED',
  'ARCHIVED',
];

const TICKET_TYPES: TicketType[] = [
  'BUG',
  'FEATURE',
  'CHORE',
  'IMPROVEMENT',
  'SPIKE',
  'RESEARCH',
];

function validateTicketStatus(value: string | undefined): TicketStatus | undefined {
  if (!value) return undefined;
  if (!(TICKET_STATUSES as string[]).includes(value)) {
    throw new Error(
      `Invalid ticket status "${value}". Valid: ${TICKET_STATUSES.join(', ')}`,
    );
  }
  return value as TicketStatus;
}

function validateTicketType(value: string | undefined): TicketType | undefined {
  if (!value) return undefined;
  if (!(TICKET_TYPES as string[]).includes(value)) {
    throw new Error(
      `Invalid ticket type "${value}". Valid: ${TICKET_TYPES.join(', ')}`,
    );
  }
  return value as TicketType;
}

export function createTicketsCommand(): Command {
  const tickets = new Command('tickets').description(
    'Manage product backlog tickets. Tickets live under a product, link to features/epics, depend on each other, and can be implemented via actions.',
  );

  tickets
    .command('list')
    .description('List tickets in a product')
    .option('--product <slug|id>', 'Product slug or CUID (required)')
    .option('--workspace <slug|id>', 'Workspace (required when --product is a slug)')
    .option('--status <status>', `Filter by status: ${TICKET_STATUSES.join(', ')}`)
    .option('--type <type>', `Filter by type: ${TICKET_TYPES.join(', ')}`)
    .option('--feature <id>', 'Filter by feature CUID')
    .option('--epic <id>', 'Filter by epic CUID')
    .option('--assignee <id>', 'Filter by assignee user ID')
    .option('--pr <url>', 'Filter by Ticket.prUrl (exact match)')
    .option('--branch <name>', 'Filter by Ticket.branchName (exact match)')
    .option(
      '--label <slug-or-id>',
      'Filter to tickets carrying this label (repeatable; AND semantics)',
      collectRepeatable,
      [] as string[],
    )
    .action(
      async (
        options: {
          product?: string;
          workspace?: string;
          status?: string;
          type?: string;
          feature?: string;
          epic?: string;
          assignee?: string;
          pr?: string;
          branch?: string;
          label: string[];
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateTicketStatus(options.status);
          const type = validateTicketType(options.type);
          // `product.ticket.list` is product-scoped on the server — there is no
          // workspace-wide ticket query, so --pr/--branch narrow a product's
          // tickets rather than standing in for one.
          if (!options.product) {
            throw new Error(
              '--product is required. Ticket lookup is product-scoped; --pr and --branch filter within a product.',
            );
          }
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId = await resolveProductId(
            client,
            workspaceId,
            options.product,
          );
          const list = await client.tickets.list({
            productId,
            status,
            type,
            featureId: options.feature,
            epicId: options.epic,
            assigneeId: options.assignee,
            prUrl: options.pr,
            branchName: options.branch,
          });
          let filtered = list;
          if (options.label.length > 0) {
            const labelIds = new Set(
              await resolveLabelIds(client, workspaceId, options.label),
            );
            const ticketLabelSets = await Promise.all(
              list.map((t) =>
                client.labels
                  .listForEntity({ entityType: 'ticket', entityId: t.id })
                  .then((tags) => new Set(tags.map((tag) => tag.id))),
              ),
            );
            filtered = list.filter((_t, idx) => {
              const tagSet = ticketLabelSets[idx];
              if (tagSet === undefined) return false;
              for (const id of labelIds) {
                if (!tagSet.has(id)) return false;
              }
              return true;
            });
          }
          if (useJson) outputTicketsJson(filtered);
          else outputTicketsPretty(filtered);
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  tickets
    .command('get <id>')
    .description('Show a ticket with dependencies, actions, and comments')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const ticket = await client.tickets.get(id);
        if (useJson) outputTicketJson(ticket);
        else outputTicketPretty(ticket);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  tickets
    .command('show <id>')
    .description('Alias for `tickets get`')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const ticket = await client.tickets.get(id);
        if (useJson) outputTicketJson(ticket);
        else outputTicketPretty(ticket);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  tickets
    .command('create')
    .description('Create a new ticket in a product')
    .requiredOption('--product <slug|id>', 'Product slug or CUID')
    .requiredOption('-t, --title <title>', 'Ticket title')
    .option('-b, --body <text>', 'Body (markdown supported)')
    .option('--type <type>', `Ticket type: ${TICKET_TYPES.join(', ')}`)
    .option('--status <status>', `Initial status: ${TICKET_STATUSES.join(', ')}`)
    .option('--priority <n>', 'Priority 0-4 (lower = higher)', parseInt)
    .option('--points <n>', 'Story points', parseFloat)
    .option('--feature <id>', 'Feature CUID to attach to')
    .option('--scope <id>', 'Feature scope CUID to attach to (requires --feature)')
    .option('--epic <id>', 'Epic CUID to attach to')
    .option('--assignee <id>', 'Assignee user ID')
    .option('--branch <name>', 'Branch name')
    .option('--pr <url>', 'Pull request URL')
    .option('--workspace <slug|id>', 'Workspace (required when --product is a slug)')
    .option(
      '--label <slug-or-id>',
      'Label to attach (repeatable)',
      collectRepeatable,
      [] as string[],
    )
    .action(
      async (
        options: {
          product: string;
          title: string;
          body?: string;
          type?: string;
          status?: string;
          priority?: number;
          points?: number;
          feature?: string;
          scope?: string;
          epic?: string;
          assignee?: string;
          branch?: string;
          pr?: string;
          workspace?: string;
          label: string[];
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const status = validateTicketStatus(options.status);
          const type = validateTicketType(options.type);
          const client = getClient();
          const workspaceId = await resolveWorkspaceId(client, options.workspace);
          const productId = await resolveProductId(
            client,
            workspaceId,
            options.product,
          );
          const ticket = await client.tickets.create({
            productId,
            title: options.title,
            body: options.body,
            type,
            status,
            priority: options.priority,
            points: options.points,
            featureId: options.feature,
            scopeId: options.scope,
            epicId: options.epic,
            assigneeId: options.assignee,
            branchName: options.branch,
            prUrl: options.pr,
          });
          if (options.label.length > 0) {
            const tagIds = await resolveLabelIds(client, workspaceId, options.label);
            await client.labels.setEntityTags({
              entityType: 'ticket',
              entityId: ticket.id,
              tagIds,
            });
          }
          if (useJson) outputTicketJson(ticket);
          else {
            console.log('\n✓ Ticket created');
            outputTicketPretty(ticket);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  tickets
    .command('update')
    .description('Update an existing ticket')
    .requiredOption('--id <id>', 'Ticket CUID')
    .option('-t, --title <title>', 'New title')
    .option('-b, --body <text>', 'New body')
    .option('--type <type>', `Type: ${TICKET_TYPES.join(', ')}`)
    .option('--status <status>', `Status: ${TICKET_STATUSES.join(', ')}`)
    .option('--priority <n>', 'Priority 0-4 (or "null" to clear)')
    .option('--points <n>', 'Story points (or "null" to clear)')
    .option('--feature <id>', 'Feature CUID (or "null" to detach)')
    .option('--epic <id>', 'Epic CUID (or "null" to detach)')
    .option('--assignee <id>', 'Assignee user ID (or "null" to unassign)')
    .option('--branch <name>', 'Branch name (or "null")')
    .option('--pr <url>', 'PR URL (or "null")')
    .option(
      '--add-label <slug-or-id>',
      'Label to attach to this ticket (repeatable)',
      collectRepeatable,
      [] as string[],
    )
    .option(
      '--remove-label <slug-or-id>',
      'Label to detach from this ticket (repeatable)',
      collectRepeatable,
      [] as string[],
    )
    .action(
      async (
        options: {
          id: string;
          title?: string;
          body?: string;
          type?: string;
          status?: string;
          priority?: string;
          points?: string;
          feature?: string;
          epic?: string;
          assignee?: string;
          branch?: string;
          pr?: string;
          addLabel: string[];
          removeLabel: string[];
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const parseNullableInt = (v: string | undefined): number | null | undefined => {
            if (v === undefined) return undefined;
            if (v === 'null') return null;
            const n = parseInt(v, 10);
            if (isNaN(n)) throw new Error(`Invalid number: ${v}`);
            return n;
          };
          const parseNullableFloat = (v: string | undefined): number | null | undefined => {
            if (v === undefined) return undefined;
            if (v === 'null') return null;
            const n = parseFloat(v);
            if (isNaN(n)) throw new Error(`Invalid number: ${v}`);
            return n;
          };
          const parseNullableString = (v: string | undefined): string | null | undefined => {
            if (v === undefined) return undefined;
            if (v === 'null') return null;
            return v;
          };

          const status = validateTicketStatus(options.status);
          const type = validateTicketType(options.type);
          const client = getClient();
          const ticket = await client.tickets.update({
            id: options.id,
            title: options.title,
            body: options.body,
            type,
            status,
            priority: parseNullableInt(options.priority),
            points: parseNullableFloat(options.points),
            featureId: parseNullableString(options.feature),
            epicId: parseNullableString(options.epic),
            assigneeId: parseNullableString(options.assignee),
            branchName: parseNullableString(options.branch),
            prUrl: parseNullableString(options.pr),
          });
          if (options.addLabel.length > 0 || options.removeLabel.length > 0) {
            const current = await client.labels.listForEntity({
              entityType: 'ticket',
              entityId: options.id,
            });
            const currentIds = new Set(current.map((t) => t.id));
            const addIds = await resolveLabelIds(client, undefined, options.addLabel);
            const removeIds = await resolveLabelIds(client, undefined, options.removeLabel);
            for (const id of addIds) currentIds.add(id);
            for (const id of removeIds) currentIds.delete(id);
            await client.labels.setEntityTags({
              entityType: 'ticket',
              entityId: options.id,
              tagIds: [...currentIds],
            });
          }
          if (useJson) outputTicketJson(ticket);
          else {
            console.log('\n✓ Ticket updated');
            outputTicketPretty(ticket);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  tickets
    .command('delete <id>')
    .description('Delete a ticket')
    .action(async (id: string, _options: Record<string, never>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.tickets.delete(id);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id }, null, 2));
        } else {
          console.log('\n✓ Ticket deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  tickets
    .command('block <ticket>')
    .description('Mark <ticket> as blocked by another ticket')
    .requiredOption('--by <id>', 'Ticket CUID that must complete first')
    .action(
      async (ticket: string, options: { by: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const dep = await client.tickets.addDependency(ticket, options.by);
          if (useJson) {
            console.log(JSON.stringify(dep, null, 2));
          } else {
            const depId = dep.dependsOn.shortId ?? (dep.dependsOn.number != null ? `#${dep.dependsOn.number}` : dep.dependsOn.id);
            console.log(`\n✓ Ticket ${ticket} now depends on ${depId} ${dep.dependsOn.title}`);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  tickets
    .command('unblock <ticket>')
    .description('Remove a blocking dependency from <ticket>')
    .requiredOption('--by <id>', 'The ticket CUID that was blocking')
    .action(
      async (ticket: string, options: { by: string }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          await client.tickets.removeDependency(ticket, options.by);
          if (useJson) {
            console.log(JSON.stringify({ ticketId: ticket, removedBlocker: options.by }, null, 2));
          } else {
            console.log(`\n✓ Dependency removed: ${ticket} no longer blocked by ${options.by}`);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  tickets
    .command('link-action')
    .description('Attach an existing action to a ticket')
    .requiredOption('--id <id>', 'Ticket CUID')
    .requiredOption('--action <id>', 'Action CUID')
    .action(async (options: { id: string; action: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const action = await client.tickets.linkAction(options.id, options.action);
        if (useJson) outputActionJson(action);
        else {
          console.log('\n✓ Action linked to ticket');
          outputActionPretty(action);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  tickets
    .command('unlink-action')
    .description('Detach an action from whatever ticket it is on')
    .requiredOption('--action <id>', 'Action CUID')
    .action(async (options: { action: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        const action = await client.tickets.unlinkAction(options.action);
        if (useJson) outputActionJson(action);
        else {
          console.log('\n✓ Action unlinked');
          outputActionPretty(action);
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  const comment = new Command('comment').description('Manage comments on a ticket');

  comment
    .command('list')
    .description('List comments on a ticket')
    .requiredOption('--id <id>', 'Ticket CUID')
    .action(async (options: { id: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        // Ticket comments ride along on the detail fetch — there is no
        // standalone list procedure server-side.
        const ticket = await client.tickets.get(options.id);
        const comments = ticket.comments ?? [];
        if (useJson) outputCommentsJson(comments);
        else outputCommentsPretty(comments);
      } catch (error) {
        handleError(error, useJson);
      }
    });

  comment
    .command('add')
    .description('Add a comment to a ticket')
    .requiredOption('--id <id>', 'Ticket CUID')
    .requiredOption('-m, --message <text>', 'Comment content (markdown supported)')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .action(
      async (
        options: {
          id: string;
          message: string;
          mention: string[];
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const content =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const created = await client.tickets.addComment({
            ticketId: options.id,
            content,
          });
          if (useJson) outputCommentJson(created);
          else {
            console.log('\n✓ Comment added');
            outputCommentPretty(created);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  comment
    .command('update')
    .description('Update one of your own ticket comments')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .requiredOption('-m, --message <text>', 'New comment content')
    .option('--mention <name>', MENTION_OPTION_DESCRIPTION, collectMention, [])
    .option(
      '--workspace <slug|id>',
      'Workspace used to resolve --mention (defaults to your default workspace)',
    )
    .action(
      async (
        options: {
          commentId: string;
          message: string;
          mention: string[];
          workspace?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
        try {
          const client = getClient();
          const content =
            options.mention.length > 0
              ? await applyMentions(
                  client,
                  await resolveWorkspaceId(client, options.workspace),
                  options.message,
                  options.mention,
                )
              : options.message;

          const updated = await client.tickets.updateComment({
            id: options.commentId,
            content,
          });
          if (useJson) outputCommentJson(updated);
          else {
            console.log('\n✓ Comment updated');
            outputCommentPretty(updated);
          }
        } catch (error) {
          handleError(error, useJson);
        }
      },
    );

  comment
    .command('delete')
    .description('Delete one of your own ticket comments')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .action(async (options: { commentId: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const useJson = shouldUseJson(globalOpts.json, globalOpts.pretty);
      try {
        const client = getClient();
        await client.tickets.deleteComment(options.commentId);
        if (useJson) {
          console.log(JSON.stringify({ deleted: true, id: options.commentId }, null, 2));
        } else {
          console.log('\n✓ Comment deleted');
        }
      } catch (error) {
        handleError(error, useJson);
      }
    });

  tickets.addCommand(comment);

  return tickets;
}

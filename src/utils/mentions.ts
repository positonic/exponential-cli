import type { ExponentialClient, WorkspaceMember } from 'exponential-sdk';

/**
 * Mentions are stored as `@[Display Name](userId)` markup inside a comment
 * body — that exact form is what the server parses to decide who gets
 * notified. Typing it by hand means knowing someone's user id, so `--mention`
 * takes a name, email, or id and expands it here.
 *
 * Substitution is in-place where possible: `--mention andi -m "@andi ptal?"`
 * produces `@[Andi Stanner](clx…) ptal?`, so the sentence still reads. Tokens
 * with no matching `@handle` in the body get prepended instead, which keeps
 * `--mention andi -m "ptal?"` working too.
 */

function candidateLabels(member: WorkspaceMember): string[] {
  const labels = [member.id];
  if (member.name) {
    labels.push(member.name);
    // "Andi Stanner" should also answer to "andi".
    const first = member.name.trim().split(/\s+/)[0];
    if (first) labels.push(first);
  }
  if (member.email) {
    labels.push(member.email);
    const local = member.email.split('@')[0];
    if (local) labels.push(local);
  }
  return labels;
}

function describe(member: WorkspaceMember): string {
  return member.name ?? member.email ?? member.id;
}

/**
 * Resolve one `--mention` token to a workspace member.
 *
 * Exact id, name, or email wins outright. Otherwise the token is matched
 * case-insensitively against first names and email local-parts. An ambiguous
 * token is an error rather than a guess — mentioning the wrong colleague is
 * worse than failing.
 */
export function resolveMember(
  members: WorkspaceMember[],
  token: string,
): WorkspaceMember {
  const needle = token.trim().toLowerCase().replace(/^@/, '');

  const exact = members.filter(
    (m) =>
      m.id.toLowerCase() === needle ||
      m.name?.toLowerCase() === needle ||
      m.email?.toLowerCase() === needle,
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new Error(
      `"${token}" matches ${exact.length} members. Use a user id instead: ${exact
        .map((m) => `${describe(m)} (${m.id})`)
        .join(', ')}`,
    );
  }

  const partial = members.filter((m) =>
    candidateLabels(m).some((l) => l.toLowerCase() === needle),
  );
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new Error(
      `"${token}" is ambiguous — matches ${partial
        .map((m) => `${describe(m)} (${m.id})`)
        .join(', ')}. Use a full name, email, or user id.`,
    );
  }

  const known = members.map(describe).join(', ');
  throw new Error(
    `No workspace member matches "${token}". Members: ${known || '(none)'}. ` +
      'Run `exponential workspaces members` to see the roster.',
  );
}

/** Escape a token for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expand `--mention` tokens into a comment body.
 *
 * Returns the body unchanged when no mentions were requested, so the common
 * path costs nothing — the member roster is only fetched when it's needed.
 */
export async function applyMentions(
  client: ExponentialClient,
  workspaceId: string,
  body: string,
  mentions: string[] | undefined,
): Promise<string> {
  if (!mentions || mentions.length === 0) return body;

  const members = await client.workspaces.listMembers(workspaceId);

  let result = body;
  const prepend: string[] = [];

  for (const token of mentions) {
    const member = resolveMember(members, token);
    const handle = token.trim().replace(/^@/, '');
    // Replace `@handle` in the body when the author wrote one, so the mention
    // lands where they meant it to. `(?![\w-])` stops `@andi` matching inside
    // `@andidev`.
    const inline = new RegExp(`@${escapeRegExp(handle)}(?![\\w-])`, 'gi');
    const substituted = result.replace(inline, member.mentionSyntax);
    if (substituted !== result) {
      result = substituted;
    } else if (!result.includes(member.mentionSyntax)) {
      prepend.push(member.mentionSyntax);
    }
  }

  return prepend.length > 0 ? `${prepend.join(' ')} ${result}` : result;
}

/** Shared `--mention` option description, so every comment command reads alike. */
export const MENTION_OPTION_DESCRIPTION =
  'Mention a workspace member by name, email, or id (repeatable). ' +
  'Writing @name in the message substitutes in place; otherwise the mention is prepended.';

/** Commander collector for a repeatable option. */
export function collectMention(value: string, previous: string[]): string[] {
  return [...previous, value];
}

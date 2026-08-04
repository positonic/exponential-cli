import { describe, it, expect, vi } from 'vitest';
import type { ExponentialClient, WorkspaceMember } from 'exponential-sdk';
import { applyMentions, resolveMember } from './mentions.js';

function member(overrides: Partial<WorkspaceMember> & { id: string }): WorkspaceMember {
  return {
    name: null,
    email: null,
    image: null,
    role: 'member',
    source: 'workspace',
    teams: [],
    mentionSyntax: `@[${overrides.name ?? overrides.id}](${overrides.id})`,
    ...overrides,
  };
}

const ANDI = member({ id: 'u1', name: 'Andi Stanner', email: 'andi@syntro.fi' });
const JAMES = member({ id: 'u2', name: 'James Farrell', email: 'james@syntro.fi' });
const ANDREA = member({ id: 'u3', name: 'Andrea Blake', email: 'andrea@syntro.fi' });

function clientWith(members: WorkspaceMember[]) {
  const listMembers = vi.fn().mockResolvedValue(members);
  return {
    client: { workspaces: { listMembers } } as unknown as ExponentialClient,
    listMembers,
  };
}

describe('resolveMember', () => {
  it('matches a first name case-insensitively', () => {
    expect(resolveMember([ANDI, JAMES], 'andi').id).toBe('u1');
    expect(resolveMember([ANDI, JAMES], 'ANDI').id).toBe('u1');
  });

  it('matches a full name, an email, an email local-part, and a raw id', () => {
    expect(resolveMember([ANDI, JAMES], 'James Farrell').id).toBe('u2');
    expect(resolveMember([ANDI, JAMES], 'james@syntro.fi').id).toBe('u2');
    expect(resolveMember([ANDI, JAMES], 'james').id).toBe('u2');
    expect(resolveMember([ANDI, JAMES], 'u2').id).toBe('u2');
  });

  it('tolerates a leading @', () => {
    expect(resolveMember([ANDI], '@andi').id).toBe('u1');
  });

  it('refuses to guess between two plausible people', () => {
    const twoAndis = [ANDI, member({ id: 'u9', name: 'Andi Other', email: 'other@x.com' })];
    expect(() => resolveMember(twoAndis, 'andi')).toThrow(/ambiguous/i);
  });

  it('prefers an exact full-name match over a first-name collision', () => {
    expect(resolveMember([ANDI, ANDREA], 'Andrea Blake').id).toBe('u3');
  });

  it('names the roster when nothing matches', () => {
    expect(() => resolveMember([ANDI], 'nobody')).toThrow(/Andi Stanner/);
  });
});

describe('applyMentions', () => {
  it('leaves the body alone and skips the roster fetch when no mentions are given', async () => {
    const { client, listMembers } = clientWith([ANDI]);

    expect(await applyMentions(client, 'ws1', 'plain body', [])).toBe('plain body');
    expect(await applyMentions(client, 'ws1', 'plain body', undefined)).toBe('plain body');
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('substitutes @handle in place so the sentence still reads', async () => {
    const { client } = clientWith([ANDI]);
    const result = await applyMentions(client, 'ws1', '@andi what do you think?', ['andi']);

    expect(result).toBe('@[Andi Stanner](u1) what do you think?');
  });

  it('prepends the mention when the body has no @handle', async () => {
    const { client } = clientWith([ANDI]);
    const result = await applyMentions(client, 'ws1', 'ptal?', ['andi']);

    expect(result).toBe('@[Andi Stanner](u1) ptal?');
  });

  it('does not match a handle that is a prefix of a longer word', async () => {
    const { client } = clientWith([ANDI]);
    const result = await applyMentions(client, 'ws1', 'ping @andishere later', ['andi']);

    // The inline token did not match, so the mention is prepended instead of
    // corrupting "@andishere".
    expect(result).toBe('@[Andi Stanner](u1) ping @andishere later');
  });

  it('handles several mentions in one body', async () => {
    const { client } = clientWith([ANDI, JAMES]);
    const result = await applyMentions(
      client,
      'ws1',
      '@andi and @james — thoughts?',
      ['andi', 'james'],
    );

    expect(result).toBe('@[Andi Stanner](u1) and @[James Farrell](u2) — thoughts?');
  });

  it('does not double-prepend a mention already present in the body', async () => {
    const { client } = clientWith([ANDI]);
    const result = await applyMentions(
      client,
      'ws1',
      'already tagged @[Andi Stanner](u1)',
      ['andi'],
    );

    expect(result).toBe('already tagged @[Andi Stanner](u1)');
  });

  it('propagates an unresolvable mention rather than posting a broken tag', async () => {
    const { client } = clientWith([ANDI]);

    await expect(
      applyMentions(client, 'ws1', 'hi', ['ghost']),
    ).rejects.toThrow(/No workspace member matches "ghost"/);
  });
});

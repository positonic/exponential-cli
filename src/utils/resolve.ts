import type { ExponentialClient } from 'exponential-sdk';
import { getConfig } from '../config/index.js';

/**
 * Resolve a workspace identifier the user typed at the CLI to a workspace ID.
 *
 * Accepts:
 *   - a bare workspace CUID (returned as-is after a list lookup for safety)
 *   - a workspace slug
 *   - undefined → falls back to the configured default workspace
 *
 * Throws if nothing resolves so callers don't accidentally send a "" id.
 */
export async function resolveWorkspaceId(
  client: ExponentialClient,
  slugOrId: string | undefined,
): Promise<string> {
  const config = getConfig();
  const candidate = slugOrId ?? config.defaultWorkspaceSlug ?? config.defaultWorkspaceId;

  if (!candidate) {
    throw new Error(
      'No workspace specified and no default workspace set. Pass --workspace <slug> or run `exponential workspaces set-default <slug>`.',
    );
  }

  const workspaces = await client.workspaces.list();
  const byId = workspaces.find((w) => w.id === candidate);
  if (byId) return byId.id;
  const bySlug = workspaces.find((w) => w.slug === candidate);
  if (bySlug) return bySlug.id;

  const known = workspaces.map((w) => w.slug).join(', ');
  throw new Error(
    `Workspace "${candidate}" not found. Available: ${known || '(none)'}`,
  );
}

/**
 * Resolve a product identifier (slug or CUID) to a product ID.
 * `slugOrId` may also be a CUID — we try id lookup first when it looks
 * like one, then fall back to slug.
 */
export async function resolveProductId(
  client: ExponentialClient,
  workspaceId: string,
  slugOrId: string,
): Promise<string> {
  const product = await client.products.resolve(workspaceId, slugOrId);
  return product.id;
}


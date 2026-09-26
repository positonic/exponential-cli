import type { ExponentialClient, Pipeline, PipelineStage } from 'exponential-sdk';
import { selectOption } from './input.js';

/** Trailing CUID of a slug-prefixed id like `close_3-cmtv8ufge0001gu04f9dz1irm`. */
const SLUG_PREFIXED_ID = /-(c[a-z0-9]{20,})$/;

/**
 * Pick the pipeline `ref` names out of `pipelines`. Accepts a bare pipeline
 * id, the slug-prefixed id the web app puts in project URLs, or a name
 * (case-insensitive). Throws, naming the available pipelines, when nothing or
 * more than one matches — a guess would silently land deals on the wrong board.
 */
export function matchPipeline(pipelines: Pipeline[], ref: string): Pipeline {
  const wanted = ref.trim();
  const byId = pipelines.find((p) => p.id === wanted);
  if (byId) return byId;

  const trailingCuid = SLUG_PREFIXED_ID.exec(wanted)?.[1];
  if (trailingCuid) {
    const byCuid = pipelines.find((p) => p.id === trailingCuid);
    if (byCuid) return byCuid;
  }

  const lowered = wanted.toLowerCase();
  const byName = pipelines.filter((p) => p.name.toLowerCase() === lowered);
  if (byName.length === 1) return byName[0]!;

  const available = pipelines.map((p) => `"${p.name}" (${p.id})`).join(', ');
  if (byName.length > 1) {
    throw new Error(
      `Pipeline "${ref}" is ambiguous — ${byName.length} pipelines share that name. Pass the id instead. Available: ${available}`,
    );
  }
  throw new Error(
    `Pipeline "${ref}" not found in this workspace. Available: ${available || '(none)'}`,
  );
}

export interface ResolvePipelineOptions {
  /** `--pipeline <id|name>` as typed, if given. */
  ref?: string;
  /** JSON mode never prompts, even on a TTY. */
  useJson: boolean;
}

/**
 * Resolve which pipeline a `deals` command should target.
 *
 * - `ref` given → {@link matchPipeline}.
 * - exactly one pipeline → that one, silently (the pre-multi-pipeline behaviour).
 * - several, interactive → a select list.
 * - several, piped or `--json` → the default (oldest) pipeline plus a stderr
 *   notice, so scripts keep working but never silently read the wrong board.
 * - none → `undefined`; the caller lets the server report "no pipeline".
 */
export async function resolvePipeline(
  client: ExponentialClient,
  workspaceId: string,
  options: ResolvePipelineOptions,
): Promise<Pipeline | undefined> {
  const pipelines = await client.pipelines.list(workspaceId);
  if (options.ref !== undefined) return matchPipeline(pipelines, options.ref);
  if (pipelines.length <= 1) return pipelines[0];

  const interactive = !options.useJson && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
  if (interactive) {
    return await selectOption(
      'This workspace has several pipelines. Which one?',
      pipelines.map((p) => ({ label: `${p.name} (${p.id})`, value: p })),
    );
  }

  const fallback = pipelines[0]!;
  process.stderr.write(
    `Using default pipeline "${fallback.name}" (${fallback.id}); this workspace has ${pipelines.length} pipelines — pass --pipeline <id|name> to choose.\n`,
  );
  return fallback;
}

/**
 * Resolve `--stage` (id or case-insensitive name) against one pipeline's
 * stages. The server does not check that a stage belongs to the pipeline a
 * deal is created on, so this is what keeps `deals create --pipeline` from
 * filing a deal under another board's stage.
 */
export function matchStage(stages: PipelineStage[], ref: string, pipelineName: string): PipelineStage {
  const wanted = ref.trim();
  const byId = stages.find((s) => s.id === wanted);
  if (byId) return byId;
  const lowered = wanted.toLowerCase();
  const byName = stages.filter((s) => s.name.toLowerCase() === lowered);
  if (byName.length === 1) return byName[0]!;
  const available = stages.map((s) => `"${s.name}" (${s.id})`).join(', ');
  if (byName.length > 1) {
    throw new Error(
      `Stage "${ref}" is ambiguous on pipeline "${pipelineName}". Pass the id instead. Available: ${available}`,
    );
  }
  throw new Error(
    `Stage "${ref}" not found on pipeline "${pipelineName}". Available: ${available || '(none)'}`,
  );
}

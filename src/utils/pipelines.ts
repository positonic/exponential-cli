import type { ExponentialClient, Pipeline, PipelineStage } from 'exponential-sdk';

/** Pipeline statuses the server skips when choosing the default pipeline. */
const RETIRED_STATUSES = new Set(['CANCELLED', 'COMPLETED']);

/**
 * The pipeline the server uses when no `pipelineId` is sent: the oldest one
 * that is not retired. `pipelines` must be oldest first, as `pipelines.list`
 * returns them.
 */
export function defaultPipelineId(pipelines: Pipeline[]): string | undefined {
  return pipelines.find((p) => !RETIRED_STATUSES.has(p.status ?? ''))?.id;
}

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

/**
 * Resolve `--pipeline <id|name>` to a pipeline. Without a ref this returns
 * `undefined` and makes no request: the caller then sends no `pipelineId` and
 * the server uses its default (the oldest pipeline that is not retired),
 * exactly as before multi-pipeline support.
 */
export async function resolvePipeline(
  client: ExponentialClient,
  workspaceId: string,
  ref: string | undefined,
): Promise<Pipeline | undefined> {
  if (ref === undefined) return undefined;
  return matchPipeline(await client.pipelines.list(workspaceId), ref);
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

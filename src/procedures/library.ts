import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import type {
  ProcedureLibraryEntry,
  ProcedureLibraryItem,
  ProcedureLibraryManifest,
  ProcedureLibraryProvenance,
  ProcedureLibraryStandards,
} from '../types/procedure';
import { runProcedureSpecEvals } from '../evals/replay';
import { PROCEDURE_LIBRARY } from './library-data';
import { normalizeProcedureSpec, stableStringify } from './schema';
import { upsertProcedureVersion } from './storage';

export const PROCEDURE_LIBRARY_VERSION = '2026-05-18';
export const PROCEDURE_LIBRARY_STANDARDS: ProcedureLibraryStandards = {
  procedure_schema: 'ranse.procedure.v1',
  mcp_schema: '2025-11-25',
};

export async function listProcedureLibrary(): Promise<ProcedureLibraryEntry[]> {
  return Promise.all(
    PROCEDURE_LIBRARY.map(async (item) => {
      const entry = await hydrateLibraryItem(item);
      const { spec: _spec, reference_mcp_tools: _tools, ...summary } = entry;
      return summary;
    }),
  );
}

export async function getProcedureLibraryItem(slug: string): Promise<ProcedureLibraryItem | null> {
  const item = PROCEDURE_LIBRARY.find((entry) => entry.slug === slug);
  return item ? hydrateLibraryItem(item) : null;
}

export async function getProcedureLibraryManifest(): Promise<ProcedureLibraryManifest> {
  return {
    manifest_version: PROCEDURE_LIBRARY_VERSION,
    standards: { ...PROCEDURE_LIBRARY_STANDARDS },
    procedures: await Promise.all(PROCEDURE_LIBRARY.map(hydrateLibraryItem)),
  };
}

export async function validateProcedureLibrary(): Promise<Array<{ slug: string; ok: true }>> {
  const seen = new Set<string>();
  const results: Array<{ slug: string; ok: true }> = [];
  for (const item of PROCEDURE_LIBRARY) {
    if (seen.has(item.slug)) throw new Error(`procedure_library_duplicate_slug:${item.slug}`);
    seen.add(item.slug);
    if (!item.spec.evals?.length) throw new Error(`procedure_library_missing_evals:${item.slug}`);
    if (!item.reference_mcp_tools.length) {
      throw new Error(`procedure_library_missing_mcp_tools:${item.slug}`);
    }
    for (const tool of item.reference_mcp_tools) {
      if (!tool.server || !tool.tool || !tool.input_schema) {
        throw new Error(`procedure_library_invalid_mcp_tool:${item.slug}`);
      }
      if (tool.annotations?.openWorldHint === undefined) {
        throw new Error(`procedure_library_missing_open_world_hint:${item.slug}:${tool.tool}`);
      }
    }
    normalizeProcedureSpec(item.spec);
    const report = runProcedureSpecEvals(item.spec);
    if (report.status !== 'passed') throw new Error(`procedure_library_eval_failed:${item.slug}`);
    const hydrated = await hydrateLibraryItem(item);
    if (hydrated.provenance.spec_checksum.length !== 64) {
      throw new Error(`procedure_library_invalid_checksum:${item.slug}`);
    }
    results.push({ slug: item.slug, ok: true as const });
  }
  return results;
}

export async function installProcedureFromLibrary(
  env: Env,
  input: { workspaceId: string; actorUserId: string; slug: string },
) {
  const item = await getProcedureLibraryItem(input.slug);
  if (!item) throw new Error('procedure_library_item_not_found');
  return upsertProcedureVersion(env, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    spec: item.spec,
    sourceKind: 'seed',
    sourceRef: item.provenance.source_ref,
  });
}

async function hydrateLibraryItem(
  item: Omit<ProcedureLibraryItem, 'provenance'>,
): Promise<ProcedureLibraryItem> {
  const clone = cloneJson(item);
  return {
    ...clone,
    tags: [...clone.tags],
    required_mcp_servers: [...clone.required_mcp_servers],
    spec: cloneJson(clone.spec),
    reference_mcp_tools: cloneJson(clone.reference_mcp_tools),
    provenance: await procedureLibraryProvenance(clone),
  };
}

async function procedureLibraryProvenance(
  item: Omit<ProcedureLibraryItem, 'provenance'>,
): Promise<ProcedureLibraryProvenance> {
  const checksum = await sha256Hex(stableStringify(item.spec));
  return {
    source: 'ranse-library',
    source_ref: `library:${item.slug}@${item.version}#sha256:${checksum}`,
    library_version: PROCEDURE_LIBRARY_VERSION,
    spec_checksum_algorithm: 'sha256',
    spec_checksum: checksum,
    standards: { ...PROCEDURE_LIBRARY_STANDARDS },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

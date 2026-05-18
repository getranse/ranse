import type { Env } from '../env';
import type { ProcedureLibraryEntry, ProcedureLibraryItem } from '../types/procedure';
import { runProcedureSpecEvals } from '../evals/replay';
import { PROCEDURE_LIBRARY } from './library-data';
import { normalizeProcedureSpec } from './schema';
import { upsertProcedureVersion } from './storage';

export function listProcedureLibrary(): ProcedureLibraryEntry[] {
  return PROCEDURE_LIBRARY.map(({ spec: _spec, reference_mcp_tools: _tools, ...entry }) => ({
    ...entry,
    tags: [...entry.tags],
    required_mcp_servers: [...entry.required_mcp_servers],
  }));
}

export function getProcedureLibraryItem(slug: string): ProcedureLibraryItem | null {
  const item = PROCEDURE_LIBRARY.find((entry) => entry.slug === slug);
  return item ? (JSON.parse(JSON.stringify(item)) as ProcedureLibraryItem) : null;
}

export function validateProcedureLibrary(): Array<{ slug: string; ok: true }> {
  const seen = new Set<string>();
  return PROCEDURE_LIBRARY.map((item) => {
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
    }
    normalizeProcedureSpec(item.spec);
    const report = runProcedureSpecEvals(item.spec);
    if (report.status !== 'passed') throw new Error(`procedure_library_eval_failed:${item.slug}`);
    return { slug: item.slug, ok: true as const };
  });
}

export async function installProcedureFromLibrary(
  env: Env,
  input: { workspaceId: string; actorUserId: string; slug: string },
) {
  const item = getProcedureLibraryItem(input.slug);
  if (!item) throw new Error('procedure_library_item_not_found');
  return upsertProcedureVersion(env, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    spec: item.spec,
    sourceKind: 'seed',
    sourceRef: `library:${item.slug}@${item.version}`,
  });
}

import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import type {
  ProcedureLibraryEntry,
  ProcedureLibraryItem,
  ProcedureLibraryMcpToolSpec,
  ProcedureLibraryManifest,
  ProcedureLibraryProvenance,
  ProcedureLibraryReadiness,
  ProcedureLibraryReadinessTool,
  ProcedureLibraryStandards,
  ProcedureStep,
} from '../../types/procedure';
import { runProcedureSpecEvals } from '../evals/replay';
import { listMcpServers, listMcpTools, normalizeMcpServerName } from '../mcp/storage';
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

export async function listProcedureLibraryWithReadiness(
  env: Env,
  workspaceId: string,
): Promise<ProcedureLibraryEntry[]> {
  const [servers, tools] = await Promise.all([
    listMcpServers(env, workspaceId),
    listMcpTools(env, workspaceId),
  ]);
  return Promise.all(
    PROCEDURE_LIBRARY.map(async (item) => {
      const entry = await hydrateLibraryItem(item);
      const { spec: _spec, reference_mcp_tools: _tools, ...summary } = entry;
      return { ...summary, readiness: readinessFromInventory(entry, servers, tools) };
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

export async function getProcedureLibraryReadiness(
  env: Env,
  workspaceId: string,
  slug: string,
): Promise<ProcedureLibraryReadiness | null> {
  const item = await getProcedureLibraryItem(slug);
  return item ? assessProcedureLibraryReadiness(env, workspaceId, item) : null;
}

export async function assessProcedureLibraryReadiness(
  env: Env,
  workspaceId: string,
  item: ProcedureLibraryItem,
): Promise<ProcedureLibraryReadiness> {
  const [servers, tools] = await Promise.all([
    listMcpServers(env, workspaceId),
    listMcpTools(env, workspaceId),
  ]);
  return readinessFromInventory(item, servers, tools);
}

function readinessFromInventory(
  item: ProcedureLibraryItem,
  servers: Awaited<ReturnType<typeof listMcpServers>>,
  tools: Awaited<ReturnType<typeof listMcpTools>>,
): ProcedureLibraryReadiness {
  const serversByName = new Map(servers.map((server) => [server.name, server]));
  const toolsByServer = new Map<string, Set<string>>();
  for (const tool of tools) {
    const names = toolsByServer.get(tool.server_id) ?? new Set<string>();
    names.add(tool.name);
    toolsByServer.set(tool.server_id, names);
  }

  const readinessTools = item.reference_mcp_tools.map((reference) => {
    const serverName = normalizeMcpServerName(reference.server);
    const server = serversByName.get(serverName);
    const hasTool = server ? toolsByServer.get(server.id)?.has(reference.tool) === true : false;
    const status: ProcedureLibraryReadinessTool['status'] = !server
      ? 'missing_server'
      : server.enabled !== 1
        ? 'server_disabled'
        : hasTool
          ? 'ready'
          : 'missing_tool';
    return {
      server: serverName,
      tool: reference.tool,
      usage: reference.usage ?? 'required',
      status,
      destructive: reference.annotations?.destructiveHint === true,
      read_only: reference.annotations?.readOnlyHint === true,
    };
  });
  const required = readinessTools.filter((tool) => tool.usage !== 'optional');
  const readyRequired = required.filter((tool) => tool.status === 'ready');
  return {
    status: readyRequired.length === required.length ? 'ready' : 'needs_setup',
    ready_tool_count: readyRequired.length,
    required_tool_count: required.length,
    tools: readinessTools,
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
    validateLibraryActionContracts(item);
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

function validateLibraryActionContracts(item: Omit<ProcedureLibraryItem, 'provenance'>): void {
  const actions = collectCallActionSteps(item.spec.steps);
  const actionRefs = new Set(actions.map((step) => step.tool));
  const referenceByQualifiedName = new Map(
    item.reference_mcp_tools.map((tool) => [qualifiedMcpToolName(tool), tool]),
  );
  const requiredServers = new Set(item.required_mcp_servers.map(normalizeMcpServerName));
  const referencedServers = new Set(
    item.reference_mcp_tools.map((tool) => normalizeMcpServerName(tool.server)),
  );

  for (const server of referencedServers) {
    if (!requiredServers.has(server)) {
      throw new Error(`procedure_library_missing_required_server:${item.slug}:${server}`);
    }
  }

  for (const step of actions) {
    const reference = referenceByQualifiedName.get(step.tool);
    if (!reference) {
      throw new Error(`procedure_library_missing_mcp_reference:${item.slug}:${step.tool}`);
    }
    if (reference.annotations?.destructiveHint === true && step.requires_approval === false) {
      throw new Error(
        `procedure_library_destructive_action_without_approval:${item.slug}:${step.id}`,
      );
    }
    if (reference.annotations?.readOnlyHint !== true && step.requires_approval === false) {
      throw new Error(`procedure_library_write_action_without_approval:${item.slug}:${step.id}`);
    }
  }

  for (const reference of item.reference_mcp_tools) {
    if ((reference.usage ?? 'required') === 'optional') continue;
    const qualifiedName = qualifiedMcpToolName(reference);
    if (!actionRefs.has(qualifiedName)) {
      throw new Error(`procedure_library_unused_mcp_reference:${item.slug}:${qualifiedName}`);
    }
  }
}

function collectCallActionSteps(
  steps: ProcedureStep[],
): Array<Extract<ProcedureStep, { type: 'call_action' }>> {
  const actions: Array<Extract<ProcedureStep, { type: 'call_action' }>> = [];
  for (const step of steps) {
    if (step.type === 'call_action') actions.push(step);
    if (step.type === 'if')
      actions.push(
        ...collectCallActionSteps(step.then),
        ...collectCallActionSteps(step.else ?? []),
      );
    if (step.type === 'loop') actions.push(...collectCallActionSteps(step.steps));
  }
  return actions;
}

function qualifiedMcpToolName(tool: ProcedureLibraryMcpToolSpec): string {
  return `${normalizeMcpServerName(tool.server)}.${tool.tool}`;
}

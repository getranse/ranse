import type { ProcedureBundle } from '../../interfaces/procedures';
export type { ProcedureBundle };
import type { Env } from '../env';
import { audit } from './audit';
import { sha256Hex } from '../../lib/crypto';
import { ids } from '../../lib/ids';
import type {
  ProcedureListItem,
  ProcedureRun,
  ProcedureRunDetail,
  ProcedureRunStatus,
  ProcedureSourceKind,
  ProcedureSpec,
  ProcedureStepRun,
  ProcedureStepRunStatus,
  ProcedureVersion,
} from '../../types/shared/procedure';
import { normalizeProcedureSpec, stableStringify } from '../schemas/procedure-spec';

export async function listProcedures(env: Env, workspaceId: string): Promise<ProcedureListItem[]> {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.description, p.trigger_type, p.trigger_category,
            p.trigger_intent, p.active_version_id,
            v.version AS active_version, p.updated_at
       FROM "procedure" p
       LEFT JOIN procedure_version v ON v.id = p.active_version_id
      WHERE p.workspace_id = ? AND p.archived_at IS NULL
      ORDER BY p.updated_at DESC`,
  )
    .bind(workspaceId)
    .all<ProcedureListItem>();
  return rows.results ?? [];
}

export async function upsertProcedureVersion(
  env: Env,
  input: {
    workspaceId: string;
    actorUserId?: string | null;
    spec: unknown;
    sourceKind?: ProcedureSourceKind;
    sourceRef?: string | null;
  },
): Promise<{ procedure: ProcedureListItem; version: ProcedureVersion; created: boolean }> {
  const spec = normalizeProcedureSpec(input.spec);
  const specJson = stableStringify(spec);
  const checksum = await sha256Hex(specJson);
  const now = Date.now();
  const procedure = await findOrCreateProcedure(env, input.workspaceId, spec, now);
  const existing = await env.DB.prepare(
    `SELECT * FROM procedure_version
      WHERE workspace_id = ? AND procedure_id = ? AND version = ?`,
  )
    .bind(input.workspaceId, procedure.id, spec.version)
    .first<ProcedureVersion>();

  let version = existing;
  let created = false;
  if (existing && existing.checksum !== checksum) {
    throw new Error('procedure_version_conflict');
  }
  if (!version) {
    version = await insertProcedureVersion(env, {
      workspaceId: input.workspaceId,
      procedureId: procedure.id,
      version: spec.version,
      specJson,
      checksum,
      sourceKind: input.sourceKind ?? 'api',
      sourceRef: input.sourceRef ?? null,
      actorUserId: input.actorUserId ?? null,
      now,
    });
    created = true;
  }

  await env.DB.prepare(
    `UPDATE "procedure"
        SET name = ?, description = ?, trigger_type = ?, trigger_category = ?,
            trigger_intent = ?, active_version_id = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      spec.name,
      spec.description ?? null,
      spec.trigger.type,
      spec.trigger.category ?? null,
      spec.trigger.intent ?? null,
      version.id,
      now,
      procedure.id,
      input.workspaceId,
    )
    .run();
  await audit(env, {
    workspaceId: input.workspaceId,
    actorType: input.actorUserId ? 'user' : 'system',
    actorId: input.actorUserId ?? undefined,
    action: 'procedure.version_published',
    payload: {
      procedureId: procedure.id,
      slug: spec.slug,
      versionId: version.id,
      version: spec.version,
    },
  });
  return {
    procedure: (await getProcedure(env, input.workspaceId, procedure.id))!,
    version,
    created,
  };
}

export async function getActiveProcedure(
  env: Env,
  workspaceId: string,
  idOrSlug: string,
): Promise<ProcedureBundle | null> {
  const row = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.description, p.trigger_type, p.trigger_category,
            p.trigger_intent, p.active_version_id, p.updated_at,
            v.id AS version_id, v.workspace_id AS version_workspace_id, v.procedure_id,
            v.version, v.spec_json, v.source_kind, v.source_ref, v.checksum,
            v.created_by_user_id, v.created_at AS version_created_at
       FROM "procedure" p
       JOIN procedure_version v ON v.id = p.active_version_id
      WHERE p.workspace_id = ? AND p.archived_at IS NULL AND (p.id = ? OR p.slug = ?)`,
  )
    .bind(workspaceId, idOrSlug, idOrSlug)
    .first<any>();
  return row ? bundleFromRow(row) : null;
}

export async function getRunBundle(
  env: Env,
  workspaceId: string,
  runId: string,
): Promise<(ProcedureBundle & { run: ProcedureRun }) | null> {
  const row = await env.DB.prepare(
    `SELECT r.*, p.slug, p.name, p.description, p.trigger_type, p.trigger_category,
            p.trigger_intent, p.active_version_id, p.updated_at AS procedure_updated_at,
            v.spec_json, v.version, v.source_kind, v.source_ref, v.checksum,
            v.created_by_user_id, v.created_at AS version_created_at
       FROM procedure_run r
       JOIN "procedure" p ON p.id = r.procedure_id
       JOIN procedure_version v ON v.id = r.version_id
      WHERE r.id = ? AND r.workspace_id = ?`,
  )
    .bind(runId, workspaceId)
    .first<any>();
  if (!row) return null;
  return {
    run: row as ProcedureRun,
    procedure: {
      id: row.procedure_id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      trigger_type: row.trigger_type,
      trigger_category: row.trigger_category,
      trigger_intent: row.trigger_intent,
      active_version_id: row.active_version_id,
      active_version: row.version,
      updated_at: row.procedure_updated_at,
    },
    version: versionFromRunRow(row),
    spec: JSON.parse(row.spec_json),
  };
}

export async function createProcedureRun(
  env: Env,
  input: {
    workspaceId: string;
    procedureIdOrSlug: string;
    ticketId: string;
    actorUserId?: string | null;
    context?: Record<string, unknown>;
    triggerEventKey?: string | null;
  },
): Promise<{ run: ProcedureRun; created: boolean }> {
  const [bundle, ticket] = await Promise.all([
    getActiveProcedure(env, input.workspaceId, input.procedureIdOrSlug),
    env.DB.prepare(`SELECT id FROM ticket WHERE id = ? AND workspace_id = ?`)
      .bind(input.ticketId, input.workspaceId)
      .first<{ id: string }>(),
  ]);
  if (!bundle) throw new Error('procedure_not_found');
  if (!ticket) throw new Error('ticket_not_found');

  const now = Date.now();
  const run: ProcedureRun = {
    id: ids.procedureRun(),
    workspace_id: input.workspaceId,
    procedure_id: bundle.procedure.id,
    version_id: bundle.version.id,
    ticket_id: input.ticketId,
    trigger_event_key: input.triggerEventKey ?? null,
    status: 'queued',
    current_step: 0,
    context_json: stableStringify({
      ...(input.context ?? {}),
      ticket_id: input.ticketId,
      procedure_slug: bundle.procedure.slug,
    }),
    error: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO procedure_run (
       id, workspace_id, procedure_id, version_id, ticket_id, trigger_event_key,
       status, current_step, context_json, error, started_at, completed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, procedure_id, ticket_id, trigger_event_key) DO NOTHING`,
  )
    .bind(
      run.id,
      run.workspace_id,
      run.procedure_id,
      run.version_id,
      run.ticket_id,
      run.trigger_event_key,
      run.status,
      run.current_step,
      run.context_json,
      run.error,
      run.started_at,
      run.completed_at,
      run.created_at,
      run.updated_at,
    )
    .run();
  const existing = input.triggerEventKey
    ? await env.DB.prepare(
        `SELECT * FROM procedure_run
            WHERE workspace_id = ? AND procedure_id = ? AND ticket_id = ? AND trigger_event_key = ?`,
      )
        .bind(input.workspaceId, bundle.procedure.id, input.ticketId, input.triggerEventKey)
        .first<ProcedureRun>()
    : run;
  if (!existing) throw new Error('procedure_run_create_failed');
  if (existing.id !== run.id) return { run: existing, created: false };
  await audit(env, {
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    actorType: input.actorUserId ? 'user' : 'system',
    actorId: input.actorUserId ?? undefined,
    action: 'procedure.run_started',
    payload: { runId: run.id, procedureId: bundle.procedure.id, versionId: bundle.version.id },
  });
  return { run, created: true };
}

export async function getProcedureRunDetail(
  env: Env,
  workspaceId: string,
  runId: string,
): Promise<ProcedureRunDetail | null> {
  const bundle = await getRunBundle(env, workspaceId, runId);
  if (!bundle) return null;
  const steps = await listRunSteps(env, workspaceId, runId);
  return { run: bundle.run, procedure: bundle.procedure, steps };
}

export async function listTicketProcedureRuns(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<ProcedureRun[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM procedure_run
      WHERE workspace_id = ? AND ticket_id = ?
      ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(workspaceId, ticketId)
    .all<ProcedureRun>();
  return rows.results ?? [];
}

export async function listWaitingProcedureRunsForTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<ProcedureRun[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM procedure_run
      WHERE workspace_id = ? AND ticket_id = ? AND status = 'waiting'
      ORDER BY updated_at ASC LIMIT 25`,
  )
    .bind(workspaceId, ticketId)
    .all<ProcedureRun>();
  return rows.results ?? [];
}

export async function listTriggeredProcedures(
  env: Env,
  workspaceId: string,
  trigger: { type: 'ticket_created' | 'intent'; category?: string | null; intent?: string | null },
): Promise<ProcedureListItem[]> {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.description, p.trigger_type, p.trigger_category,
            p.trigger_intent, p.active_version_id, v.version AS active_version, p.updated_at
       FROM "procedure" p
       JOIN procedure_version v ON v.id = p.active_version_id
      WHERE p.workspace_id = ? AND p.archived_at IS NULL AND p.trigger_type = ?
        AND (p.trigger_category IS NULL OR p.trigger_category = ?)
        AND (p.trigger_intent IS NULL OR p.trigger_intent = ?)
      ORDER BY p.updated_at DESC
      LIMIT 25`,
  )
    .bind(workspaceId, trigger.type, trigger.category ?? null, trigger.intent ?? null)
    .all<ProcedureListItem>();
  return rows.results ?? [];
}

export async function updateRun(
  env: Env,
  workspaceId: string,
  runId: string,
  patch: {
    status: ProcedureRunStatus;
    currentStep?: number;
    context?: Record<string, unknown>;
    error?: string | null;
    startedAt?: number | null;
    completedAt?: number | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE procedure_run
        SET status = ?, current_step = COALESCE(?, current_step),
            context_json = COALESCE(?, context_json), error = ?,
            started_at = COALESCE(started_at, ?), completed_at = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      patch.status,
      patch.currentStep ?? null,
      patch.context ? stableStringify(patch.context) : null,
      patch.error ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
      Date.now(),
      runId,
      workspaceId,
    )
    .run();
}

export async function recordStepRun(
  env: Env,
  input: {
    workspaceId: string;
    runId: string;
    stepId: string;
    stepIndex: number;
    status: ProcedureStepRunStatus;
    input?: unknown;
    output?: unknown;
    error?: string | null;
  },
): Promise<string> {
  const id = ids.procedureStepRun();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO procedure_step_run (
       id, workspace_id, run_id, step_id, step_index, status, input_json,
       output_json, error, started_at, completed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, step_index) DO UPDATE SET
       step_id = excluded.step_id,
       status = excluded.status,
       input_json = excluded.input_json,
       output_json = excluded.output_json,
       error = excluded.error,
       completed_at = excluded.completed_at`,
  )
    .bind(
      id,
      input.workspaceId,
      input.runId,
      input.stepId,
      input.stepIndex,
      input.status,
      stableStringify(input.input ?? {}),
      stableStringify(input.output ?? {}),
      input.error ?? null,
      now,
      input.status === 'running' ? null : now,
      now,
    )
    .run();
  return id;
}

export async function getStepRunByIndex(
  env: Env,
  workspaceId: string,
  runId: string,
  stepIndex: number,
): Promise<ProcedureStepRun | null> {
  return env.DB.prepare(
    `SELECT * FROM procedure_step_run
      WHERE workspace_id = ? AND run_id = ? AND step_index = ?
      LIMIT 1`,
  )
    .bind(workspaceId, runId, stepIndex)
    .first<ProcedureStepRun>();
}

async function findOrCreateProcedure(
  env: Env,
  workspaceId: string,
  spec: ProcedureSpec,
  now: number,
) {
  const existing = await env.DB.prepare(
    `SELECT * FROM "procedure" WHERE workspace_id = ? AND slug = ?`,
  )
    .bind(workspaceId, spec.slug)
    .first<{ id: string }>();
  if (existing) return existing;
  const id = ids.procedure();
  await env.DB.prepare(
    `INSERT INTO "procedure" (
       id, workspace_id, slug, name, description, trigger_type, trigger_category,
       trigger_intent, active_version_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      spec.slug,
      spec.name,
      spec.description ?? null,
      spec.trigger.type,
      spec.trigger.category ?? null,
      spec.trigger.intent ?? null,
      now,
      now,
    )
    .run();
  return { id };
}

async function insertProcedureVersion(
  env: Env,
  input: {
    workspaceId: string;
    procedureId: string;
    version: string;
    specJson: string;
    checksum: string;
    sourceKind: ProcedureSourceKind;
    sourceRef: string | null;
    actorUserId: string | null;
    now: number;
  },
): Promise<ProcedureVersion> {
  const row: ProcedureVersion = {
    id: ids.procedureVersion(),
    workspace_id: input.workspaceId,
    procedure_id: input.procedureId,
    version: input.version,
    spec_json: input.specJson,
    source_kind: input.sourceKind,
    source_ref: input.sourceRef,
    checksum: input.checksum,
    created_by_user_id: input.actorUserId,
    created_at: input.now,
  };
  await env.DB.prepare(
    `INSERT INTO procedure_version (
       id, workspace_id, procedure_id, version, spec_json, source_kind,
       source_ref, checksum, created_by_user_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(...Object.values(row))
    .run();
  return row;
}

async function getProcedure(env: Env, workspaceId: string, procedureId: string) {
  return env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.description, p.trigger_type, p.trigger_category,
            p.trigger_intent, p.active_version_id,
            v.version AS active_version, p.updated_at
       FROM "procedure" p
       LEFT JOIN procedure_version v ON v.id = p.active_version_id
      WHERE p.id = ? AND p.workspace_id = ?`,
  )
    .bind(procedureId, workspaceId)
    .first<ProcedureListItem>();
}

async function listRunSteps(env: Env, workspaceId: string, runId: string) {
  const rows = await env.DB.prepare(
    `SELECT * FROM procedure_step_run
      WHERE workspace_id = ? AND run_id = ?
      ORDER BY step_index ASC, created_at ASC`,
  )
    .bind(workspaceId, runId)
    .all<ProcedureStepRun>();
  return rows.results ?? [];
}

function bundleFromRow(row: any): ProcedureBundle {
  return {
    procedure: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      trigger_type: row.trigger_type,
      trigger_category: row.trigger_category,
      trigger_intent: row.trigger_intent,
      active_version_id: row.active_version_id,
      active_version: row.version,
      updated_at: row.updated_at,
    },
    version: {
      id: row.version_id,
      workspace_id: row.version_workspace_id,
      procedure_id: row.procedure_id,
      version: row.version,
      spec_json: row.spec_json,
      source_kind: row.source_kind,
      source_ref: row.source_ref,
      checksum: row.checksum,
      created_by_user_id: row.created_by_user_id,
      created_at: row.version_created_at,
    },
    spec: JSON.parse(row.spec_json),
  };
}

function versionFromRunRow(row: any): ProcedureVersion {
  return {
    id: row.version_id,
    workspace_id: row.workspace_id,
    procedure_id: row.procedure_id,
    version: row.version,
    spec_json: row.spec_json,
    source_kind: row.source_kind,
    source_ref: row.source_ref,
    checksum: row.checksum,
    created_by_user_id: row.created_by_user_id,
    created_at: row.version_created_at,
  };
}

import type { Env } from '../env';
import { ids } from '../../lib/ids';
import type {
  EvalCase,
  EvalCaseSource,
  EvalResult,
  EvalResultStatus,
  EvalRun,
  EvalRunDetail,
  EvalRunSource,
  EvalRunStatus,
} from '../../types/shared/evals';

export async function upsertEvalCase(
  env: Env,
  input: {
    workspaceId: string;
    source: EvalCaseSource;
    ticketId?: string | null;
    procedureId?: string | null;
    procedureVersionId?: string | null;
    name: string;
    inputJson: string;
    expectedJson: string;
    anonymizationJson: string;
    sourceFingerprint: string;
  },
): Promise<EvalCase> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO eval_case (
       id, workspace_id, source, ticket_id, procedure_id, procedure_version_id,
       name, status, input_json, expected_json, anonymization_json, source_fingerprint,
       captured_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, source, source_fingerprint) DO UPDATE SET
       ticket_id = excluded.ticket_id,
       procedure_id = excluded.procedure_id,
       procedure_version_id = excluded.procedure_version_id,
       name = excluded.name,
       status = 'active',
       input_json = excluded.input_json,
       expected_json = excluded.expected_json,
       anonymization_json = excluded.anonymization_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      ids.evalCase(),
      input.workspaceId,
      input.source,
      input.ticketId ?? null,
      input.procedureId ?? null,
      input.procedureVersionId ?? null,
      input.name,
      input.inputJson,
      input.expectedJson,
      input.anonymizationJson,
      input.sourceFingerprint,
      now,
      now,
    )
    .run();
  const row = await env.DB.prepare(
    `SELECT * FROM eval_case
      WHERE workspace_id = ? AND source = ? AND source_fingerprint = ?`,
  )
    .bind(input.workspaceId, input.source, input.sourceFingerprint)
    .first<EvalCase>();
  if (!row) throw new Error('eval_case_upsert_failed');
  return row;
}

export async function listEvalCases(
  env: Env,
  workspaceId: string,
  params: { status?: 'active' | 'archived'; limit?: number; caseIds?: string[] } = {},
): Promise<EvalCase[]> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const bindings: unknown[] = [workspaceId];
  const clauses = ['workspace_id = ?'];
  if (params.status) {
    clauses.push('status = ?');
    bindings.push(params.status);
  }
  if (params.caseIds?.length) {
    clauses.push(`id IN (${params.caseIds.map(() => '?').join(',')})`);
    bindings.push(...params.caseIds);
  }
  bindings.push(limit);
  const rows = await env.DB.prepare(
    `SELECT * FROM eval_case
      WHERE ${clauses.join(' AND ')}
      ORDER BY captured_at DESC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all<EvalCase>();
  return rows.results ?? [];
}

export async function updateEvalCaseStatus(
  env: Env,
  workspaceId: string,
  caseId: string,
  status: 'active' | 'archived',
): Promise<EvalCase | null> {
  await env.DB.prepare(
    `UPDATE eval_case SET status = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(status, Date.now(), caseId, workspaceId)
    .run();
  return env.DB.prepare(`SELECT * FROM eval_case WHERE id = ? AND workspace_id = ?`)
    .bind(caseId, workspaceId)
    .first<EvalCase>();
}

export async function listEvalRuns(env: Env, workspaceId: string, limit = 20): Promise<EvalRun[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM eval_run
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, Math.min(Math.max(limit, 1), 100))
    .all<EvalRun>();
  return rows.results ?? [];
}

export async function createEvalRun(
  env: Env,
  input: {
    workspaceId: string;
    source: EvalRunSource;
    config: Record<string, unknown>;
  },
): Promise<EvalRun> {
  const now = Date.now();
  const run: EvalRun = {
    id: ids.evalRun(),
    workspace_id: input.workspaceId,
    source: input.source,
    status: 'running',
    case_count: 0,
    passed_count: 0,
    failed_count: 0,
    regression_count: 0,
    config_json: JSON.stringify(input.config),
    started_at: now,
    completed_at: null,
    created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO eval_run (
       id, workspace_id, source, status, case_count, passed_count, failed_count,
       regression_count, config_json, started_at, completed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      run.id,
      run.workspace_id,
      run.source,
      run.status,
      run.case_count,
      run.passed_count,
      run.failed_count,
      run.regression_count,
      run.config_json,
      run.started_at,
      run.completed_at,
      run.created_at,
    )
    .run();
  return run;
}

export async function insertEvalResult(
  env: Env,
  input: {
    workspaceId: string;
    runId: string;
    caseId: string;
    status: EvalResultStatus;
    score?: number | null;
    assertions: unknown[];
    actual: unknown;
    error?: string | null;
  },
): Promise<EvalResult> {
  const result: EvalResult = {
    id: ids.evalResult(),
    workspace_id: input.workspaceId,
    run_id: input.runId,
    case_id: input.caseId,
    status: input.status,
    score: input.score ?? null,
    assertions_json: JSON.stringify(input.assertions),
    actual_json: JSON.stringify(input.actual),
    error: input.error ?? null,
    created_at: Date.now(),
  };
  await env.DB.prepare(
    `INSERT INTO eval_result (
       id, workspace_id, run_id, case_id, status, score, assertions_json,
       actual_json, error, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      result.id,
      result.workspace_id,
      result.run_id,
      result.case_id,
      result.status,
      result.score,
      result.assertions_json,
      result.actual_json,
      result.error,
      result.created_at,
    )
    .run();
  return result;
}

export async function getLatestEvalResultForCase(
  env: Env,
  workspaceId: string,
  caseId: string,
): Promise<EvalResult | null> {
  return env.DB.prepare(
    `SELECT r.*
       FROM eval_result r
       JOIN eval_run er ON er.id = r.run_id
      WHERE r.workspace_id = ? AND r.case_id = ?
        AND r.status IN ('passed','failed')
        AND er.status IN ('passed','failed')
      ORDER BY r.created_at DESC
      LIMIT 1`,
  )
    .bind(workspaceId, caseId)
    .first<EvalResult>();
}

export async function completeEvalRun(
  env: Env,
  workspaceId: string,
  runId: string,
  counts: {
    caseCount: number;
    passedCount: number;
    failedCount: number;
    regressionCount: number;
  },
): Promise<EvalRun> {
  const status: EvalRunStatus =
    counts.failedCount > 0 || counts.regressionCount > 0 ? 'failed' : 'passed';
  await env.DB.prepare(
    `UPDATE eval_run
        SET status = ?, case_count = ?, passed_count = ?, failed_count = ?,
            regression_count = ?, completed_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      status,
      counts.caseCount,
      counts.passedCount,
      counts.failedCount,
      counts.regressionCount,
      Date.now(),
      runId,
      workspaceId,
    )
    .run();
  const row = await env.DB.prepare(`SELECT * FROM eval_run WHERE id = ? AND workspace_id = ?`)
    .bind(runId, workspaceId)
    .first<EvalRun>();
  if (!row) throw new Error('eval_run_not_found');
  return row;
}

export async function getEvalRunDetail(
  env: Env,
  workspaceId: string,
  runId: string,
): Promise<EvalRunDetail | null> {
  const run = await env.DB.prepare(`SELECT * FROM eval_run WHERE id = ? AND workspace_id = ?`)
    .bind(runId, workspaceId)
    .first<EvalRun>();
  if (!run) return null;
  const rows = await env.DB.prepare(
    `SELECT r.*, c.name AS case_name, c.source AS case_source
       FROM eval_result r
       JOIN eval_case c ON c.id = r.case_id
      WHERE r.run_id = ? AND r.workspace_id = ?
      ORDER BY r.created_at ASC`,
  )
    .bind(runId, workspaceId)
    .all<EvalResult & { case_name?: string; case_source?: EvalCaseSource }>();
  return { run, results: rows.results ?? [] };
}

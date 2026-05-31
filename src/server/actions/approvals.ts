import type { ApprovalInput } from '../../interfaces/approvals.ts';
export type { ApprovalInput };
import type { Env } from '../env';
import { ids } from '../../lib/ids';

export async function createApproval(env: Env, input: ApprovalInput): Promise<string> {
  const id = ids.approval();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO approval_request (id, workspace_id, ticket_id, kind, status, proposed_json, risk_reasons_json, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.ticketId,
      input.kind,
      JSON.stringify(input.proposed),
      JSON.stringify(input.riskReasons),
      input.expiresInMs ? now + input.expiresInMs : null,
      now,
    )
    .run();
  return id;
}

export async function decideApproval(
  env: Env,
  approvalId: string,
  decision: 'approved' | 'rejected',
  userId: string,
  workspaceId?: string,
): Promise<{ workspaceId: string; ticketId: string; kind: string; proposed: any } | null> {
  const row = await env.DB.prepare(
    `SELECT workspace_id, ticket_id, kind, proposed_json, status
       FROM approval_request
      WHERE id = ? AND (? IS NULL OR workspace_id = ?)`,
  )
    .bind(approvalId, workspaceId ?? null, workspaceId ?? null)
    .first<{ workspace_id: string; ticket_id: string; kind: string; proposed_json: string; status: string }>();
  if (!row) return null;
  if (row.status !== 'pending') return null;
  await env.DB.prepare(
    `UPDATE approval_request SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?`,
  )
    .bind(decision, userId, Date.now(), approvalId)
    .run();
  return {
    workspaceId: row.workspace_id,
    ticketId: row.ticket_id,
    kind: row.kind,
    proposed: JSON.parse(row.proposed_json),
  };
}

export async function getApprovalRequest(
  env: Env,
  workspaceId: string,
  approvalId: string,
): Promise<{ workspaceId: string; ticketId: string; kind: string; proposed: any; status: string } | null> {
  const row = await env.DB.prepare(
    `SELECT workspace_id, ticket_id, kind, proposed_json, status
       FROM approval_request
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(approvalId, workspaceId)
    .first<{
      workspace_id: string;
      ticket_id: string;
      kind: string;
      proposed_json: string;
      status: string;
    }>();
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    ticketId: row.ticket_id,
    kind: row.kind,
    proposed: JSON.parse(row.proposed_json),
    status: row.status,
  };
}

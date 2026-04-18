import type { Env } from '../env';
import { ids } from './ids';

export interface AuditInput {
  workspaceId: string;
  ticketId?: string;
  actorType: 'user' | 'agent' | 'system';
  actorId?: string;
  action: string;
  payload?: Record<string, unknown>;
}

export async function audit(env: Env, input: AuditInput): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO audit_event (id, workspace_id, ticket_id, actor_type, actor_id, action, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ids.audit(),
      input.workspaceId,
      input.ticketId ?? null,
      input.actorType,
      input.actorId ?? null,
      input.action,
      JSON.stringify(input.payload ?? {}),
      now,
    )
    .run();
}

import type { Env } from '../../env';

export interface SLAPolicy {
  first_response_minutes: { normal: number; high: number; urgent: number };
  resolution_hours: { normal: number; high: number; urgent: number };
  business_hours_only: boolean;
}

export const DEFAULT_SLA: SLAPolicy = {
  first_response_minutes: { normal: 240, high: 60, urgent: 15 },
  resolution_hours: { normal: 48, high: 8, urgent: 2 },
  business_hours_only: false,
};

export interface SLAStatus {
  first_response_due_at: number;
  resolution_due_at: number;
  first_response_breached: boolean;
  resolution_breached: boolean;
}

export function computeSLA(params: {
  policy: SLAPolicy;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  firstMessageAt: number;
  firstResponseAt?: number;
  resolvedAt?: number;
  now?: number;
}): SLAStatus {
  const p = params.priority === 'low' ? 'normal' : params.priority;
  const frDue = params.firstMessageAt + params.policy.first_response_minutes[p] * 60_000;
  const resDue = params.firstMessageAt + params.policy.resolution_hours[p] * 3_600_000;
  const now = params.now ?? Date.now();
  return {
    first_response_due_at: frDue,
    resolution_due_at: resDue,
    first_response_breached: !params.firstResponseAt && now > frDue,
    resolution_breached: !params.resolvedAt && now > resDue,
  };
}

export async function findBreachingTickets(
  env: Env,
  workspaceId: string,
  policy: SLAPolicy = DEFAULT_SLA,
): Promise<Array<{ id: string; subject: string; priority: string; breach: SLAStatus }>> {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.subject, t.priority, t.created_at, t.last_message_at, t.status,
       (SELECT MIN(sent_at) FROM message_index WHERE ticket_id = t.id AND direction = 'outbound') AS first_resp,
       (SELECT MAX(created_at) FROM audit_event WHERE ticket_id = t.id AND action = 'ticket.resolved') AS resolved
     FROM ticket t
     WHERE t.workspace_id = ? AND t.status IN ('open','pending')`,
  )
    .bind(workspaceId)
    .all<{ id: string; subject: string; priority: any; created_at: number; first_resp: number | null; resolved: number | null }>();

  const out: Array<{ id: string; subject: string; priority: string; breach: SLAStatus }> = [];
  for (const r of rows.results ?? []) {
    const breach = computeSLA({
      policy,
      priority: r.priority,
      firstMessageAt: r.created_at,
      firstResponseAt: r.first_resp ?? undefined,
      resolvedAt: r.resolved ?? undefined,
    });
    if (breach.first_response_breached || breach.resolution_breached) {
      out.push({ id: r.id, subject: r.subject, priority: r.priority, breach });
    }
  }
  return out;
}

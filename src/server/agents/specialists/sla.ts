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
       c.sla_first_response_minutes AS channel_fr_minutes,
       c.sla_resolution_minutes AS channel_res_minutes,
       (SELECT MIN(sent_at) FROM message_index WHERE ticket_id = t.id AND direction = 'outbound') AS first_resp,
       (SELECT MAX(created_at) FROM audit_event WHERE ticket_id = t.id AND action = 'ticket.resolved') AS resolved
     FROM ticket t
     LEFT JOIN public_channel c ON c.id = t.origin_channel_id AND c.workspace_id = t.workspace_id
     WHERE t.workspace_id = ? AND t.status IN ('open','pending')`,
  )
    .bind(workspaceId)
    .all<{
      id: string;
      subject: string;
      priority: any;
      created_at: number;
      first_resp: number | null;
      resolved: number | null;
      channel_fr_minutes: number | null;
      channel_res_minutes: number | null;
    }>();

  const out: Array<{ id: string; subject: string; priority: string; breach: SLAStatus }> = [];
  for (const r of rows.results ?? []) {
    const effectivePolicy = applyChannelOverrides(policy, r.channel_fr_minutes, r.channel_res_minutes);
    const breach = computeSLA({
      policy: effectivePolicy,
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

function applyChannelOverrides(
  policy: SLAPolicy,
  channelFirstResponseMinutes: number | null,
  channelResolutionMinutes: number | null,
): SLAPolicy {
  if (channelFirstResponseMinutes === null && channelResolutionMinutes === null) return policy;
  // A channel-specific SLA overrides the priority curve uniformly. This is
  // intentional: a customer reaching out over SMS expects the same response
  // regardless of how the operator triaged the priority.
  const fr = channelFirstResponseMinutes;
  const res = channelResolutionMinutes;
  return {
    first_response_minutes: {
      normal: fr ?? policy.first_response_minutes.normal,
      high: fr ?? policy.first_response_minutes.high,
      urgent: fr ?? policy.first_response_minutes.urgent,
    },
    resolution_hours: {
      normal: res ? Math.max(1, Math.round(res / 60)) : policy.resolution_hours.normal,
      high: res ? Math.max(1, Math.round(res / 60)) : policy.resolution_hours.high,
      urgent: res ? Math.max(1, Math.round(res / 60)) : policy.resolution_hours.urgent,
    },
    business_hours_only: policy.business_hours_only,
  };
}

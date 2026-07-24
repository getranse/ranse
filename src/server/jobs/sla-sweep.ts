import type { SLABreachAuditPayload } from '../../interfaces/jobs';
import { audit } from '../actions/audit';
import type { Env } from '../env';
import { parseWorkspaceSLAPolicy } from '../inbox/agents/specialists/business-hours';
import { findBreachingTickets } from '../inbox/agents/specialists/sla';

/**
 * Iterates every workspace and emits audit events for any ticket whose SLA
 * has breached since the last sweep. Deduped by a marker audit row
 * `ticket.sla_breached` per (ticket_id, breach_type) so we don't spam.
 */
export async function runSLASweep(
  env: Env,
): Promise<{ workspacesScanned: number; breaches: number }> {
  const rows = await env.DB.prepare(`SELECT id, settings_json FROM workspace`).all<{
    id: string;
    settings_json: string | null;
  }>();
  const workspaces = rows.results ?? [];
  let totalBreaches = 0;

  for (const ws of workspaces) {
    const breaches = await findBreachingTickets(
      env,
      ws.id,
      parseWorkspaceSLAPolicy(ws.settings_json),
    );
    for (const b of breaches) {
      for (const kind of ['first_response', 'resolution'] as const) {
        const breached =
          kind === 'first_response'
            ? b.breach.first_response_breached
            : b.breach.resolution_breached;
        if (!breached) continue;

        const already = await env.DB.prepare(
          `SELECT 1 FROM audit_event
           WHERE workspace_id = ? AND ticket_id = ? AND action = ? LIMIT 1`,
        )
          .bind(ws.id, b.id, `ticket.sla_breached.${kind}`)
          .first();
        if (already) continue;

        const payload: SLABreachAuditPayload = {
          first_response_breached: b.breach.first_response_breached,
          resolution_breached: b.breach.resolution_breached,
          priority: b.priority,
          due_at:
            kind === 'first_response' ? b.breach.first_response_due_at : b.breach.resolution_due_at,
        };
        await audit(env, {
          workspaceId: ws.id,
          ticketId: b.id,
          actorType: 'system',
          action: `ticket.sla_breached.${kind}`,
          payload: payload as any,
        });
        totalBreaches++;
      }
    }
  }

  return { workspacesScanned: workspaces.length, breaches: totalBreaches };
}

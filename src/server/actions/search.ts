import type { TicketSearchHit } from '../../interfaces/tickets';
import type { Env } from '../env';

/**
 * User input → safe FTS5 MATCH expression: each whitespace token becomes a
 * quoted prefix phrase ("refun"* matches refund/refunds), which neutralizes
 * FTS5 operators (AND/OR/NEAR/-) in raw customer-typed queries.
 */
export function toMatchExpression(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

/**
 * Search tickets by message content (subject + preview), best match first.
 * Requester email/name are matched via the ticket row so "jane@" finds her
 * tickets even when the text never mentions the address.
 */
export async function searchTickets(
  env: Env,
  workspaceId: string,
  query: string,
  limit = 20,
): Promise<TicketSearchHit[]> {
  const match = toMatchExpression(query);
  if (!match) return [];
  const capped = Math.min(Math.max(1, limit), 50);

  // snippet()/rank only work in a plain MATCH query (joins/aggregates make
  // SQLite reject them), so matches are fetched per message and deduped per
  // ticket in code — first hit per ticket is the best-ranked one.
  const matches = await env.DB.prepare(
    `SELECT ticket_id, snippet(message_fts, 0, '[', ']', '…', 12) AS snippet
       FROM message_fts
      WHERE message_fts MATCH ? AND workspace_id = ?
      ORDER BY rank
      LIMIT ?`,
  )
    .bind(match, workspaceId, capped * 5)
    .all<{ ticket_id: string; snippet: string }>();

  const snippets = new Map<string, string>();
  for (const m of matches.results ?? []) {
    if (!snippets.has(m.ticket_id)) snippets.set(m.ticket_id, m.snippet);
    if (snippets.size >= capped) break;
  }

  const hits: TicketSearchHit[] = [];
  if (snippets.size > 0) {
    const ids = [...snippets.keys()];
    const rows = await env.DB.prepare(
      `SELECT id, subject, status, priority, requester_email, last_message_at
         FROM ticket WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    )
      .bind(workspaceId, ...ids)
      .all<Omit<TicketSearchHit, 'snippet'>>();
    const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));
    for (const id of ids) {
      const t = byId.get(id);
      if (t) hits.push({ ...t, snippet: snippets.get(id) ?? null });
    }
  }
  if (hits.length >= capped) return hits;

  const seen = new Set(hits.map((h) => h.id));
  const requester = await env.DB.prepare(
    `SELECT id, subject, status, priority, requester_email, last_message_at, NULL AS snippet
       FROM ticket
      WHERE workspace_id = ? AND (requester_email LIKE ? OR requester_name LIKE ?)
      ORDER BY last_message_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, `%${query.trim()}%`, `%${query.trim()}%`, capped)
    .all<TicketSearchHit>();
  for (const hit of requester.results ?? []) {
    if (!seen.has(hit.id) && hits.length < capped) hits.push(hit);
  }
  return hits;
}

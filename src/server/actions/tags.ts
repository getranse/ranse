import type { Tag } from '../../interfaces/tickets';
import { ids } from '../../lib/ids';
import type { Env } from '../env';

export async function listTags(env: Env, workspaceId: string): Promise<Tag[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, color, created_at FROM tag WHERE workspace_id = ? ORDER BY name`,
  )
    .bind(workspaceId)
    .all<Tag>();
  return rows.results ?? [];
}

/** Create a tag, or return the existing one with the same name (case-insensitive). */
export async function createTag(
  env: Env,
  workspaceId: string,
  name: string,
  color?: string | null,
): Promise<Tag> {
  const normalized = name.trim();
  const existing = await env.DB.prepare(
    `SELECT id, name, color, created_at FROM tag WHERE workspace_id = ? AND name = ? COLLATE NOCASE`,
  )
    .bind(workspaceId, normalized)
    .first<Tag>();
  if (existing) return existing;
  const now = Date.now();
  const tag: Tag = { id: ids.message(), name: normalized, color: color ?? null, created_at: now };
  await env.DB.prepare(
    `INSERT INTO tag (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(tag.id, workspaceId, tag.name, tag.color, tag.created_at)
    .run();
  return tag;
}

export async function deleteTag(env: Env, workspaceId: string, tagId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM ticket_tag WHERE workspace_id = ? AND tag_id = ?`)
    .bind(workspaceId, tagId)
    .run();
  await env.DB.prepare(`DELETE FROM tag WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, tagId)
    .run();
}

/** Assign a tag; both the ticket and the tag must belong to the workspace. */
export async function tagTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
  tagId: string,
): Promise<boolean> {
  const ok = await env.DB.prepare(
    `SELECT (SELECT 1 FROM ticket WHERE id = ?1 AND workspace_id = ?3) AS t,
            (SELECT 1 FROM tag WHERE id = ?2 AND workspace_id = ?3) AS g`,
  )
    .bind(ticketId, tagId, workspaceId)
    .first<{ t: number | null; g: number | null }>();
  if (!ok?.t || !ok?.g) return false;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ticket_tag (ticket_id, tag_id, workspace_id, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(ticketId, tagId, workspaceId, Date.now())
    .run();
  return true;
}

export async function untagTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
  tagId: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM ticket_tag WHERE workspace_id = ? AND ticket_id = ? AND tag_id = ?`,
  )
    .bind(workspaceId, ticketId, tagId)
    .run();
}

export async function listTicketTags(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<Tag[]> {
  const rows = await env.DB.prepare(
    `SELECT g.id, g.name, g.color, g.created_at
       FROM ticket_tag tt JOIN tag g ON g.id = tt.tag_id
      WHERE tt.workspace_id = ? AND tt.ticket_id = ?
      ORDER BY g.name`,
  )
    .bind(workspaceId, ticketId)
    .all<Tag>();
  return rows.results ?? [];
}

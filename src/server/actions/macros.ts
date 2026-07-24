import type { Macro } from '../../interfaces/macros';
import { ids } from '../../lib/ids';
import type { Env } from '../env';

export async function listMacros(env: Env, workspaceId: string): Promise<Macro[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, body, created_at FROM macro WHERE workspace_id = ? ORDER BY name`,
  )
    .bind(workspaceId)
    .all<Macro>();
  return rows.results ?? [];
}

export async function createMacro(
  env: Env,
  workspaceId: string,
  name: string,
  body: string,
): Promise<Macro> {
  const macro: Macro = { id: ids.message(), name: name.trim(), body, created_at: Date.now() };
  await env.DB.prepare(
    `INSERT INTO macro (id, workspace_id, name, body, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(macro.id, workspaceId, macro.name, macro.body, macro.created_at)
    .run();
  return macro;
}

export async function updateMacro(
  env: Env,
  workspaceId: string,
  id: string,
  fields: { name?: string; body?: string },
): Promise<boolean> {
  const existing = await env.DB.prepare(
    `SELECT name, body FROM macro WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, id)
    .first<{ name: string; body: string }>();
  if (!existing) return false;
  await env.DB.prepare(`UPDATE macro SET name = ?, body = ? WHERE workspace_id = ? AND id = ?`)
    .bind(fields.name?.trim() ?? existing.name, fields.body ?? existing.body, workspaceId, id)
    .run();
  return true;
}

export async function deleteMacro(env: Env, workspaceId: string, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM macro WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, id)
    .run();
}

/**
 * Render a macro body for a ticket: {{customer_name}}, {{customer_email}},
 * {{ticket_subject}}, {{agent_name}}. Unknown placeholders are left intact so
 * typos stay visible to the operator instead of silently vanishing.
 */
export function renderMacro(
  body: string,
  vars: {
    customer_name?: string | null;
    customer_email?: string | null;
    ticket_subject?: string | null;
    agent_name?: string | null;
  },
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = (vars as Record<string, string | null | undefined>)[key];
    return value ?? whole;
  });
}

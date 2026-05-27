import type { Env } from '../../env';
import { audit } from '../../lib/audit';
import type { AgentConfig } from '../../llm/config.types';
import type { SupervisorState } from '../../../types/supervisor';

export async function loadWorkspaceByDOName(env: Env, name?: string): Promise<{ workspaceId: string; workspaceName: string } | null> {
  if (!name) return null;
  const row = await env.DB.prepare(`SELECT id, name FROM workspace WHERE id = ?`)
    .bind(name)
    .first<{ id: string; name: string }>();
  return row ? { workspaceId: row.id, workspaceName: row.name } : null;
}

export async function aiDraftsEnabled(env: Env, workspaceId: string, ticketId: string): Promise<boolean> {
  const t = await env.DB.prepare(`SELECT ai_drafts_enabled FROM ticket WHERE id = ? AND workspace_id = ?`)
    .bind(ticketId, workspaceId)
    .first<{ ai_drafts_enabled: number | null }>();
  if (t?.ai_drafts_enabled === 1) return true;
  if (t?.ai_drafts_enabled === 0) return false;

  const w = await env.DB.prepare(`SELECT settings_json FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ settings_json: string }>();
  try {
    const s = w ? JSON.parse(w.settings_json || '{}') : {};
    return s.ai_drafts_enabled === true;
  } catch {
    return false;
  }
}

export async function workspaceConfig(env: Env, workspaceId: string): Promise<Partial<AgentConfig> | undefined> {
  if (!workspaceId) return undefined;
  const rows = await env.DB.prepare(
    `SELECT action_key, model_name, fallback_model, reasoning_effort, temperature
       FROM workspace_llm_config WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .all<{ action_key: string; model_name: string; fallback_model: string | null; reasoning_effort: string | null; temperature: number | null }>();
  const out: any = {};
  for (const r of rows.results ?? []) {
    out[r.action_key] = {
      model: r.model_name,
      fallbackModel: r.fallback_model ?? undefined,
      reasoningEffort: (r.reasoning_effort as any) ?? undefined,
      temperature: r.temperature ?? undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

export async function getWorkspaceSettings(env: Env, workspaceId: string) {
  const w = await env.DB.prepare(`SELECT name, settings_json FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ name: string; settings_json: string }>();
  try {
    const s = w ? JSON.parse(w.settings_json || '{}') : {};
    return {
      ai_drafts_enabled: s.ai_drafts_enabled === true,
      from_name: typeof s.from_name === 'string' ? s.from_name : '',
      logo_url: typeof s.logo_url === 'string' ? s.logo_url : '',
      workspace_name: w?.name ?? '',
    };
  } catch {
    return { ai_drafts_enabled: false, from_name: '', logo_url: '', workspace_name: w?.name ?? '' };
  }
}

export async function setWorkspaceSettings(env: Env, workspaceId: string, args: {
  actorUserId: string;
  ai_drafts_enabled?: boolean;
  from_name?: string;
  logo_url?: string;
}): Promise<{ ok: boolean }> {
  const w = await env.DB.prepare(`SELECT settings_json FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ settings_json: string }>();
  let settings: Record<string, unknown> = {};
  try { settings = w ? JSON.parse(w.settings_json || '{}') : {}; } catch { settings = {}; }
  if (args.ai_drafts_enabled !== undefined) settings.ai_drafts_enabled = !!args.ai_drafts_enabled;
  if (args.from_name !== undefined) settings.from_name = args.from_name.trim().slice(0, 100);
  if (args.logo_url !== undefined) settings.logo_url = args.logo_url.trim().slice(0, 500);

  await env.DB.prepare(`UPDATE workspace SET settings_json = ? WHERE id = ?`)
    .bind(JSON.stringify(settings), workspaceId)
    .run();
  await audit(env, { workspaceId, actorType: 'user', actorId: args.actorUserId, action: 'workspace.settings_changed', payload: args });
  return { ok: true };
}

export async function getAgentProfile(env: Env, workspaceId: string, userId: string) {
  const u = await env.DB.prepare(
    `SELECT u.name, u.email, u.signature_markdown, u.avatar_url
       FROM user u JOIN workspace_user wu ON wu.user_id = u.id
      WHERE u.id = ? AND wu.workspace_id = ?`,
  )
    .bind(userId, workspaceId)
    .first<{ name: string | null; email: string; signature_markdown: string | null; avatar_url: string | null }>();
  return u ? { name: u.name ?? '', email: u.email, signature_markdown: u.signature_markdown ?? '', avatar_url: u.avatar_url ?? '' } : null;
}

export async function setAgentProfile(env: Env, args: {
  userId: string;
  name?: string;
  signature_markdown?: string;
  avatar_url?: string;
}): Promise<{ ok: boolean }> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (args.name !== undefined) { fields.push('name = ?'); values.push(args.name.trim().slice(0, 100)); }
  if (args.signature_markdown !== undefined) { fields.push('signature_markdown = ?'); values.push(args.signature_markdown.slice(0, 5000)); }
  if (args.avatar_url !== undefined) { fields.push('avatar_url = ?'); values.push(args.avatar_url.trim().slice(0, 500)); }
  if (fields.length === 0) return { ok: true };
  await env.DB.prepare(`UPDATE user SET ${fields.join(', ')} WHERE id = ?`).bind(...values, args.userId).run();
  return { ok: true };
}

export async function refreshCounts(env: Env, state: SupervisorState, setState: (state: SupervisorState) => void | Promise<void>): Promise<void> {
  const [open, approvals] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM ticket WHERE workspace_id = ? AND status = 'open'`).bind(state.workspaceId).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM approval_request WHERE workspace_id = ? AND status = 'pending'`).bind(state.workspaceId).first<{ n: number }>(),
  ]);
  await setState({ ...state, openCount: open?.n ?? 0, currentApprovals: approvals?.n ?? 0, lastSyncAt: Date.now() });
}

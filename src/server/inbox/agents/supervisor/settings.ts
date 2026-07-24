import type { SupervisorState } from '../../../../types/shared/supervisor';
import { audit, diffChanges } from '../../../actions/audit';
import type { Env } from '../../../env';

export async function loadWorkspaceByDOName(
  env: Env,
  name?: string,
): Promise<{ workspaceId: string; workspaceName: string } | null> {
  if (!name) return null;
  const row = await env.DB.prepare(`SELECT id, name FROM workspace WHERE id = ?`)
    .bind(name)
    .first<{ id: string; name: string }>();
  return row ? { workspaceId: row.id, workspaceName: row.name } : null;
}

export async function aiDraftsEnabled(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<boolean> {
  const t = await env.DB.prepare(
    `SELECT ai_drafts_enabled FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
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

export async function getWorkspaceSettings(env: Env, workspaceId: string) {
  const w = await env.DB.prepare(`SELECT name, settings_json FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ name: string; settings_json: string }>();
  try {
    const s = w ? JSON.parse(w.settings_json || '{}') : {};
    return {
      ai_drafts_enabled: s.ai_drafts_enabled === true,
      audit_read_logging: s.audit_read_logging === true,
      from_name: typeof s.from_name === 'string' ? s.from_name : '',
      logo_url: typeof s.logo_url === 'string' ? s.logo_url : '',
      workspace_name: w?.name ?? '',
    };
  } catch {
    return {
      ai_drafts_enabled: false,
      audit_read_logging: false,
      from_name: '',
      logo_url: '',
      workspace_name: w?.name ?? '',
    };
  }
}

export async function setWorkspaceSettings(
  env: Env,
  workspaceId: string,
  args: {
    actorUserId: string;
    ai_drafts_enabled?: boolean;
    audit_read_logging?: boolean;
    from_name?: string;
    logo_url?: string;
  },
): Promise<{ ok: boolean }> {
  const w = await env.DB.prepare(`SELECT settings_json FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ settings_json: string }>();
  let settings: Record<string, unknown> = {};
  try {
    settings = w ? JSON.parse(w.settings_json || '{}') : {};
  } catch {
    settings = {};
  }
  const before = { ...settings };
  if (args.ai_drafts_enabled !== undefined) settings.ai_drafts_enabled = !!args.ai_drafts_enabled;
  if (args.audit_read_logging !== undefined)
    settings.audit_read_logging = !!args.audit_read_logging;
  if (args.from_name !== undefined) settings.from_name = args.from_name.trim().slice(0, 100);
  if (args.logo_url !== undefined) settings.logo_url = args.logo_url.trim().slice(0, 500);

  await env.DB.prepare(`UPDATE workspace SET settings_json = ? WHERE id = ?`)
    .bind(JSON.stringify(settings), workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: args.actorUserId,
    action: 'workspace.settings_changed',
    payload: { changes: diffChanges(before, settings) },
  });
  return { ok: true };
}

export async function refreshCounts(
  env: Env,
  state: SupervisorState,
  setState: (state: SupervisorState) => void | Promise<void>,
): Promise<void> {
  const [open, approvals] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM ticket WHERE workspace_id = ? AND status = 'open'`)
      .bind(state.workspaceId)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM approval_request WHERE workspace_id = ? AND status = 'pending'`,
    )
      .bind(state.workspaceId)
      .first<{ n: number }>(),
  ]);
  await setState({
    ...state,
    openCount: open?.n ?? 0,
    currentApprovals: approvals?.n ?? 0,
    lastSyncAt: Date.now(),
  });
}

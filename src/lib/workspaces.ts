import type { Env } from '../env';
import { audit } from './audit';
import { randomToken } from './crypto';
import { ids } from './ids';
import { WORKSPACE_ROLES, type WorkspaceInvitation, type WorkspaceMember, type WorkspaceRole, type WorkspaceSummary } from '../types/workspace';

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function hasWorkspaceRole(role: WorkspaceRole, allowed: readonly WorkspaceRole[]): boolean {
  return allowed.includes(role);
}

export function slugifyWorkspaceName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'workspace';
}

export async function nextWorkspaceSlug(env: Env, name: string, excludeWorkspaceId?: string): Promise<string> {
  const base = slugifyWorkspaceName(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const row = await env.DB.prepare(
      `SELECT id FROM workspace WHERE slug = ? AND (? IS NULL OR id != ?)`,
    ).bind(slug, excludeWorkspaceId ?? null, excludeWorkspaceId ?? null).first<{ id: string }>();
    if (!row) return slug;
  }
  return `${base}-${ids.workspace().slice(-6)}`;
}

export async function listUserWorkspaces(env: Env, userId: string): Promise<WorkspaceSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT w.id, w.name, w.slug, wu.role
       FROM workspace_user wu
       JOIN workspace w ON w.id = wu.workspace_id
      WHERE wu.user_id = ? AND w.archived_at IS NULL AND w.deleted_at IS NULL
      ORDER BY w.created_at ASC`,
  ).bind(userId).all<WorkspaceSummary>();
  return rows.results ?? [];
}

export async function getMembershipRole(env: Env, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const row = await env.DB.prepare(
    `SELECT wu.role
       FROM workspace_user wu
       JOIN workspace w ON w.id = wu.workspace_id
      WHERE wu.user_id = ? AND wu.workspace_id = ?
        AND w.archived_at IS NULL AND w.deleted_at IS NULL`,
  ).bind(userId, workspaceId).first<{ role: string }>();
  return row && isWorkspaceRole(row.role) ? row.role : null;
}

export async function createWorkspaceForUser(env: Env, userId: string, name: string): Promise<WorkspaceSummary> {
  const workspaceId = ids.workspace();
  const now = Date.now();
  const slug = await nextWorkspaceSlug(env, name);
  const settings = JSON.stringify({ from_name: name });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workspace (id, name, slug, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(workspaceId, name, slug, settings, now, now),
    env.DB.prepare(
      `INSERT INTO workspace_user (workspace_id, user_id, role, created_at)
       VALUES (?, ?, 'owner', ?)`,
    ).bind(workspaceId, userId, now),
  ]);
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: userId,
    action: 'workspace.created',
    payload: { name },
  });
  return { id: workspaceId, name, slug, role: 'owner' };
}

export async function switchSessionWorkspace(env: Env, sessionId: string, userId: string, workspaceId: string) {
  const role = await getMembershipRole(env, userId, workspaceId);
  if (!role) return null;
  await env.DB.prepare(`UPDATE session SET workspace_id = ? WHERE id = ? AND user_id = ?`)
    .bind(workspaceId, sessionId, userId)
    .run();
  const row = await env.DB.prepare(`SELECT id, name, slug FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ id: string; name: string; slug: string }>();
  return row ? { ...row, role } : null;
}

export async function updateWorkspaceName(env: Env, workspaceId: string, userId: string, name: string): Promise<void> {
  const slug = await nextWorkspaceSlug(env, name, workspaceId);
  await env.DB.prepare(`UPDATE workspace SET name = ?, slug = ?, updated_at = ? WHERE id = ?`)
    .bind(name, slug, Date.now(), workspaceId)
    .run();
  await audit(env, { workspaceId, actorType: 'user', actorId: userId, action: 'workspace.updated', payload: { name } });
}

export async function archiveWorkspace(env: Env, workspaceId: string, userId: string): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE workspace SET archived_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, workspaceId),
    env.DB.prepare(`UPDATE session SET workspace_id = NULL WHERE workspace_id = ?`).bind(workspaceId),
  ]);
  await audit(env, { workspaceId, actorType: 'user', actorId: userId, action: 'workspace.archived' });
}

export async function transferWorkspaceOwnership(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
): Promise<'ok' | 'not_found'> {
  const target = await getMembershipRole(env, targetUserId, workspaceId);
  if (!target) return 'not_found';
  await env.DB.batch([
    env.DB.prepare(`UPDATE workspace_user SET role = 'owner' WHERE workspace_id = ? AND user_id = ?`)
      .bind(workspaceId, targetUserId),
    env.DB.prepare(`UPDATE workspace_user SET role = 'admin' WHERE workspace_id = ? AND user_id = ? AND user_id != ?`)
      .bind(workspaceId, actorUserId, targetUserId),
  ]);
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'workspace.ownership_transferred',
    payload: { targetUserId },
  });
  return 'ok';
}

export async function deleteWorkspace(env: Env, workspaceId: string, userId: string): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE workspace SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, workspaceId),
    env.DB.prepare(`UPDATE session SET workspace_id = NULL WHERE workspace_id = ?`).bind(workspaceId),
  ]);
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: userId,
    action: 'workspace.deleted',
    payload: { policy: 'soft_delete', retained_for_export: true },
  });
}

export async function setSessionWorkspaceFallback(env: Env, sessionId: string, userId: string): Promise<string | undefined> {
  const fallback = await listUserWorkspaces(env, userId);
  const workspaceId = fallback[0]?.id;
  await env.DB.prepare(`UPDATE session SET workspace_id = ? WHERE id = ? AND user_id = ?`)
    .bind(workspaceId ?? null, sessionId, userId)
    .run();
  return workspaceId;
}

export async function listWorkspaceMembers(env: Env, workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, u.name, wu.role, wu.created_at
       FROM workspace_user wu
       JOIN user u ON u.id = wu.user_id
      WHERE wu.workspace_id = ?
      ORDER BY wu.created_at ASC`,
  ).bind(workspaceId).all<WorkspaceMember>();
  return rows.results ?? [];
}

export async function createWorkspaceInvitation(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  email: string,
  role: WorkspaceRole,
): Promise<WorkspaceInvitation> {
  const now = Date.now();
  const invitation = {
    id: ids.invitation(),
    email: email.toLowerCase(),
    role,
    token: randomToken(24),
    accepted_at: null,
    expires_at: now + 1000 * 60 * 60 * 24 * 7,
    created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO workspace_invitation (id, workspace_id, email, role, token, expires_at, invited_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(invitation.id, workspaceId, invitation.email, invitation.role, invitation.token,
    invitation.expires_at, actorUserId, invitation.created_at).run();
  await audit(env, { workspaceId, actorType: 'user', actorId: actorUserId, action: 'workspace.invitation_created', payload: { email, role } });
  return invitation;
}

export async function listWorkspaceInvitations(env: Env, workspaceId: string): Promise<WorkspaceInvitation[]> {
  const rows = await env.DB.prepare(
    `SELECT id, email, role, token, accepted_at, expires_at, created_at
       FROM workspace_invitation
      WHERE workspace_id = ?
      ORDER BY created_at DESC`,
  ).bind(workspaceId).all<WorkspaceInvitation>();
  return rows.results ?? [];
}

async function countWorkspaceOwners(env: Env, workspaceId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM workspace_user WHERE workspace_id = ? AND role = 'owner'`,
  ).bind(workspaceId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function updateWorkspaceMemberRole(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
  role: WorkspaceRole,
): Promise<'ok' | 'not_found' | 'last_owner'> {
  const current = await env.DB.prepare(
    `SELECT role FROM workspace_user WHERE workspace_id = ? AND user_id = ?`,
  ).bind(workspaceId, targetUserId).first<{ role: WorkspaceRole }>();
  if (!current) return 'not_found';
  if (current.role === 'owner' && role !== 'owner' && await countWorkspaceOwners(env, workspaceId) <= 1) {
    return 'last_owner';
  }
  await env.DB.prepare(`UPDATE workspace_user SET role = ? WHERE workspace_id = ? AND user_id = ?`)
    .bind(role, workspaceId, targetUserId)
    .run();
  await audit(env, { workspaceId, actorType: 'user', actorId: actorUserId, action: 'workspace.member_role_changed', payload: { targetUserId, role } });
  return 'ok';
}

export async function removeWorkspaceMember(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
): Promise<'ok' | 'not_found' | 'last_owner'> {
  const current = await env.DB.prepare(
    `SELECT role FROM workspace_user WHERE workspace_id = ? AND user_id = ?`,
  ).bind(workspaceId, targetUserId).first<{ role: WorkspaceRole }>();
  if (!current) return 'not_found';
  if (current.role === 'owner' && await countWorkspaceOwners(env, workspaceId) <= 1) return 'last_owner';
  await env.DB.prepare(`DELETE FROM workspace_user WHERE workspace_id = ? AND user_id = ?`)
    .bind(workspaceId, targetUserId)
    .run();
  await audit(env, { workspaceId, actorType: 'user', actorId: actorUserId, action: 'workspace.member_removed', payload: { targetUserId } });
  return 'ok';
}

export async function acceptWorkspaceInvitation(env: Env, userId: string, token: string): Promise<WorkspaceSummary | null> {
  const now = Date.now();
  const user = await env.DB.prepare(`SELECT email FROM user WHERE id = ?`).bind(userId).first<{ email: string }>();
  if (!user) return null;
  const invitation = await env.DB.prepare(
    `SELECT wi.id, wi.workspace_id, wi.email, wi.role, w.name, w.slug
       FROM workspace_invitation wi
       JOIN workspace w ON w.id = wi.workspace_id
      WHERE wi.token = ? AND wi.accepted_at IS NULL AND wi.expires_at > ?
        AND w.archived_at IS NULL AND w.deleted_at IS NULL`,
  ).bind(token, now).first<{ id: string; workspace_id: string; email: string; role: string; name: string; slug: string }>();
  if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase() || !isWorkspaceRole(invitation.role)) {
    return null;
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workspace_user (workspace_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role`,
    ).bind(invitation.workspace_id, userId, invitation.role, now),
    env.DB.prepare(`UPDATE workspace_invitation SET accepted_at = ? WHERE id = ?`).bind(now, invitation.id),
  ]);
  await audit(env, {
    workspaceId: invitation.workspace_id,
    actorType: 'user',
    actorId: userId,
    action: 'workspace.invitation_accepted',
  });
  return { id: invitation.workspace_id, name: invitation.name, slug: invitation.slug, role: invitation.role };
}

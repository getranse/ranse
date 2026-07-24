import type { Team } from '../../interfaces/teams';
import { ids } from '../../lib/ids';
import type { Env } from '../env';

export async function listTeams(env: Env, workspaceId: string): Promise<Team[]> {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.name, t.created_at, COUNT(m.user_id) AS member_count
       FROM team t LEFT JOIN team_member m ON m.team_id = t.id
      WHERE t.workspace_id = ? GROUP BY t.id ORDER BY t.name`,
  )
    .bind(workspaceId)
    .all<Team>();
  return rows.results ?? [];
}

export async function createTeam(env: Env, workspaceId: string, name: string): Promise<Team> {
  const team = { id: ids.message(), name: name.trim(), created_at: Date.now(), member_count: 0 };
  await env.DB.prepare(`INSERT INTO team (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)`)
    .bind(team.id, workspaceId, team.name, team.created_at)
    .run();
  return team;
}

export async function deleteTeam(env: Env, workspaceId: string, teamId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM team_member WHERE workspace_id = ? AND team_id = ?`)
    .bind(workspaceId, teamId)
    .run();
  await env.DB.prepare(`UPDATE ticket SET team_id = NULL WHERE workspace_id = ? AND team_id = ?`)
    .bind(workspaceId, teamId)
    .run();
  await env.DB.prepare(
    `UPDATE mailbox SET default_team_id = NULL WHERE workspace_id = ? AND default_team_id = ?`,
  )
    .bind(workspaceId, teamId)
    .run();
  await env.DB.prepare(`DELETE FROM team WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, teamId)
    .run();
}

/** Add a workspace member to a team; rejects users outside the workspace. */
export async function addTeamMember(
  env: Env,
  workspaceId: string,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const ok = await env.DB.prepare(
    `SELECT (SELECT 1 FROM team WHERE id = ?1 AND workspace_id = ?3) AS t,
            (SELECT 1 FROM workspace_user WHERE user_id = ?2 AND workspace_id = ?3) AS u`,
  )
    .bind(teamId, userId, workspaceId)
    .first<{ t: number | null; u: number | null }>();
  if (!ok?.t || !ok?.u) return false;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team_member (team_id, user_id, workspace_id, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(teamId, userId, workspaceId, Date.now())
    .run();
  return true;
}

export async function removeTeamMember(
  env: Env,
  workspaceId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM team_member WHERE workspace_id = ? AND team_id = ? AND user_id = ?`,
  )
    .bind(workspaceId, teamId, userId)
    .run();
}

export async function listTeamMembers(
  env: Env,
  workspaceId: string,
  teamId: string,
): Promise<Array<{ user_id: string; email: string; name: string | null }>> {
  const rows = await env.DB.prepare(
    `SELECT m.user_id, u.email, u.name
       FROM team_member m JOIN user u ON u.id = m.user_id
      WHERE m.workspace_id = ? AND m.team_id = ?
      ORDER BY u.email`,
  )
    .bind(workspaceId, teamId)
    .all<{ user_id: string; email: string; name: string | null }>();
  return rows.results ?? [];
}

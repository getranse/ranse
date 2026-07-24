import type { Env } from '../env';

/**
 * Round-robin by load: the team member carrying the fewest open/pending
 * assigned tickets wins; ties break on user id for determinism. Returns null
 * for empty teams.
 */
export async function pickRoundRobinAssignee(
  env: Env,
  workspaceId: string,
  teamId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT m.user_id,
            (SELECT COUNT(*) FROM ticket t
              WHERE t.workspace_id = m.workspace_id AND t.assignee_user_id = m.user_id
                AND t.status IN ('open', 'pending')) AS open_count
       FROM team_member m
      WHERE m.workspace_id = ? AND m.team_id = ?
      ORDER BY open_count ASC, m.user_id ASC
      LIMIT 1`,
  )
    .bind(workspaceId, teamId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/**
 * Auto-assignment hook for newly created tickets: when the origin mailbox
 * names a default team, stamp the team and round-robin an assignee. No-op
 * (never throws) when unconfigured — ingest must not fail on assignment.
 */
export async function autoAssignNewTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
  mailboxId: string,
): Promise<void> {
  try {
    const mailbox = await env.DB.prepare(
      `SELECT default_team_id FROM mailbox WHERE id = ? AND workspace_id = ?`,
    )
      .bind(mailboxId, workspaceId)
      .first<{ default_team_id: string | null }>();
    if (!mailbox?.default_team_id) return;
    const assignee = await pickRoundRobinAssignee(env, workspaceId, mailbox.default_team_id);
    await env.DB.prepare(
      `UPDATE ticket SET team_id = ?, assignee_user_id = COALESCE(?, assignee_user_id)
        WHERE id = ? AND workspace_id = ?`,
    )
      .bind(mailbox.default_team_id, assignee, ticketId, workspaceId)
      .run();
  } catch (err) {
    console.warn('auto-assign failed', err);
  }
}

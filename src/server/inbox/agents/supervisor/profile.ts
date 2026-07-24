import type { Env } from '../../../env';

export async function getAgentProfile(env: Env, workspaceId: string, userId: string) {
  const u = await env.DB.prepare(
    `SELECT u.name, u.email, u.signature_markdown, u.avatar_url
       FROM user u JOIN workspace_user wu ON wu.user_id = u.id
      WHERE u.id = ? AND wu.workspace_id = ?`,
  )
    .bind(userId, workspaceId)
    .first<{
      name: string | null;
      email: string;
      signature_markdown: string | null;
      avatar_url: string | null;
    }>();
  return u
    ? {
        name: u.name ?? '',
        email: u.email,
        signature_markdown: u.signature_markdown ?? '',
        avatar_url: u.avatar_url ?? '',
      }
    : null;
}

export async function setAgentProfile(
  env: Env,
  args: {
    userId: string;
    name?: string;
    signature_markdown?: string;
    avatar_url?: string;
  },
): Promise<{ ok: boolean }> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (args.name !== undefined) {
    fields.push('name = ?');
    values.push(args.name.trim().slice(0, 100));
  }
  if (args.signature_markdown !== undefined) {
    fields.push('signature_markdown = ?');
    values.push(args.signature_markdown.slice(0, 5000));
  }
  if (args.avatar_url !== undefined) {
    fields.push('avatar_url = ?');
    values.push(args.avatar_url.trim().slice(0, 500));
  }
  if (fields.length === 0) return { ok: true };
  await env.DB.prepare(`UPDATE user SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values, args.userId)
    .run();
  return { ok: true };
}

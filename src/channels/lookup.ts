import type { Env } from '../env';
import type { PublicChannel } from '../types/channels';

export async function listPublicChannels(env: Env, workspaceId: string): Promise<PublicChannel[]> {
  const rows = await env.DB.prepare(
    `SELECT c.*, m.address AS mailbox_address
       FROM public_channel c
       JOIN mailbox m ON m.id = c.mailbox_id AND m.workspace_id = c.workspace_id
      WHERE c.workspace_id = ?
      ORDER BY c.updated_at DESC`,
  )
    .bind(workspaceId)
    .all<PublicChannel>();
  return rows.results ?? [];
}

export async function getPublicChannel(
  env: Env,
  workspaceId: string,
  channelId: string,
): Promise<PublicChannel | null> {
  return env.DB.prepare(
    `SELECT c.*, m.address AS mailbox_address
       FROM public_channel c
       JOIN mailbox m ON m.id = c.mailbox_id AND m.workspace_id = c.workspace_id
      WHERE c.workspace_id = ? AND c.id = ?`,
  )
    .bind(workspaceId, channelId)
    .first<PublicChannel>();
}

export async function getPublicChannelByKey(
  env: Env,
  publicKey: string,
): Promise<PublicChannel | null> {
  return env.DB.prepare(
    `SELECT c.*, m.address AS mailbox_address
       FROM public_channel c
       JOIN mailbox m ON m.id = c.mailbox_id AND m.workspace_id = c.workspace_id
      WHERE c.public_key = ?`,
  )
    .bind(publicKey)
    .first<PublicChannel>();
}

export async function getMailbox(env: Env, workspaceId: string, mailboxId: string) {
  return env.DB.prepare(`SELECT id, address FROM mailbox WHERE id = ? AND workspace_id = ?`)
    .bind(mailboxId, workspaceId)
    .first<{ id: string; address: string }>();
}

import type { Env } from '../env';
import { parseReplyAddress } from './reply-security';

export interface RoutedMailbox {
  workspaceId: string;
  mailboxId: string;
  mailboxAddress: string;
  replySigningSecret: string;
  ticketId?: string;
}

export async function resolveMailboxForRecipients(
  env: Env,
  recipients: string[],
): Promise<RoutedMailbox | null> {
  if (recipients.length === 0) return null;

  const rows = await env.DB.prepare(
    `SELECT id, workspace_id, address, reply_signing_secret
     FROM mailbox
     WHERE address IN (${recipients.map(() => '?').join(',')})`,
  )
    .bind(...recipients.map((r) => r.toLowerCase()))
    .all<{ id: string; workspace_id: string; address: string; reply_signing_secret: string }>();

  const direct = rows.results?.[0];
  if (direct) {
    return {
      workspaceId: direct.workspace_id,
      mailboxId: direct.id,
      mailboxAddress: direct.address,
      replySigningSecret: direct.reply_signing_secret,
    };
  }

  // Try reply+{ticketId}.{sig}@support... addresses
  for (const r of recipients) {
    const domain = r.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    const mbRows = await env.DB.prepare(
      `SELECT id, workspace_id, address, reply_signing_secret
       FROM mailbox WHERE lower(substr(address, instr(address,'@')+1)) = ?`,
    )
      .bind(domain)
      .all<{ id: string; workspace_id: string; address: string; reply_signing_secret: string }>();
    for (const mb of mbRows.results ?? []) {
      const match = await parseReplyAddress(r, mb.reply_signing_secret);
      if (match) {
        return {
          workspaceId: mb.workspace_id,
          mailboxId: mb.id,
          mailboxAddress: mb.address,
          replySigningSecret: mb.reply_signing_secret,
          ticketId: match.ticketId,
        };
      }
    }
  }

  return null;
}

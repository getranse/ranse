import type { Env } from '../../env';

export type InvitationDelivery = 'sent' | 'skipped_no_mailbox' | 'skipped_no_email_binding' | 'failed';

export async function sendWorkspaceInvitationEmail(
  env: Env,
  workspaceId: string,
  to: string,
  acceptUrl: string,
): Promise<InvitationDelivery> {
  if (!(env as any).EMAIL) return 'skipped_no_email_binding';
  const row = await env.DB.prepare(
    `SELECT w.name AS workspace_name, m.address AS mailbox_address
       FROM workspace w
       LEFT JOIN mailbox m ON m.workspace_id = w.id
      WHERE w.id = ?
      ORDER BY m.created_at ASC
      LIMIT 1`,
  ).bind(workspaceId).first<{ workspace_name: string; mailbox_address: string | null }>();
  const domain = row?.mailbox_address?.split('@')[1];
  if (!domain) return 'skipped_no_mailbox';

  const fromAddress = `notifications@mail.${domain}`;
  const subject = `Join ${row?.workspace_name ?? 'Ranse'}`;
  const body = [
    `You have been invited to join ${row?.workspace_name ?? 'a Ranse workspace'}.`,
    '',
    `Accept the invitation: ${acceptUrl}`,
    '',
    'If you were not expecting this invitation, ignore this email.',
  ].join('\n');
  const raw = [
    `From: Ranse <${fromAddress}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n');

  const { EmailMessage } = await import('cloudflare:email');
  await env.EMAIL.send(new EmailMessage(fromAddress, to, raw));
  return 'sent';
}

import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
import { getAgentByName } from 'agents';
import { ids } from '../../../lib/ids';
import { putRaw, r2Keys } from '../../../lib/storage';
import type { InboundEmailPayload } from '../../../types/shared/supervisor';
import { processInboundBounce } from '../../actions/suppression';
import type { Env } from '../../env';
import { detectBounce } from './bounce';
import { parseInbound } from './parsing';
import { resolveMailboxForRecipients } from './routing';

export async function handleEmailMessage(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const rlKey = `ingest:${message.from}`;
  const rl = await env.RATE_LIMIT_INGEST?.limit({ key: rlKey }).catch(() => ({ success: true }));
  if (rl && !rl.success) {
    await message.setReject('Rate limited');
    return;
  }

  const routed = await resolveMailboxForRecipients(env, [message.to]);
  if (!routed) {
    await message.setReject('Unknown recipient');
    return;
  }

  const parsed = await parseInbound(message);
  const rawKey = r2Keys.rawEmail(routed.workspaceId, routed.mailboxId, parsed.messageId);
  await putRaw(env, rawKey, parsed.rawBytes, 'message/rfc822');

  // Bounces are suppressed + audited, then ingested with the auto-reply flag
  // so the thread shows the failure but triage/draft never answers a
  // mailer-daemon. Suppression failure must not lose the inbound message.
  const bounce = detectBounce(parsed);
  if (bounce) {
    await processInboundBounce(env, {
      workspaceId: routed.workspaceId,
      ticketId: routed.ticketId ?? null,
      bounce,
    }).catch((err) => console.warn('failed to process bounce', err));
  }

  for (const att of parsed.attachments) {
    const attId = ids.message();
    await putRaw(
      env,
      r2Keys.attachment(routed.workspaceId, 'pending', attId, att.filename),
      att.content,
      att.mimeType,
    );
  }

  const mailboxStub = await getAgentByName(env.MailboxAgent as never, routed.mailboxId);
  await (mailboxStub as any).recordInbound({ autoReply: parsed.isAutoReply });

  const payload: InboundEmailPayload = {
    mailboxId: routed.mailboxId,
    mailboxAddress: routed.mailboxAddress,
    replySigningSecret: routed.replySigningSecret,
    existingTicketId: routed.ticketId,
    from: parsed.from,
    to: parsed.to,
    cc: parsed.cc,
    subject: parsed.subject,
    text: parsed.text,
    html: parsed.html,
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
    isAutoReply: parsed.isAutoReply || bounce !== null,
    rawKey,
    receivedAt: Date.now(),
    attachmentCount: parsed.attachments.length,
  };

  const supervisorStub = await getAgentByName(
    env.WorkspaceSupervisorAgent as never,
    routed.workspaceId,
  );
  await (supervisorStub as any).ingestEmail(payload);
}

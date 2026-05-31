import type { DispatchInput, DispatchOutcome } from '../../../interfaces/channels';
export type { DispatchInput, DispatchOutcome };
import type { Env } from '../../env';
import { ids } from '../../../lib/ids';
import { canDeliverTo } from '../notifications/preferences';
import type {
  ChannelKind,
  EgressMessage,
  EgressResult,
  PublicChannel,
} from '../../../types/shared/channels';
import { getAdapter } from './registry';

export async function dispatchOutbound(env: Env, input: DispatchInput): Promise<DispatchOutcome> {
  const target = await resolveDispatchTarget(env, input);
  if (!target) {
    return {
      status: 'skipped',
      channelKind: 'email',
      channelId: null,
      externalId: null,
      error: 'no_origin_channel',
    };
  }
  if (target.kind === 'email') {
    // Email outbound is handled by the legacy reply pipeline directly; the
    // dispatcher only records the email send result when the email adapter
    // is invoked explicitly.
    return {
      status: 'skipped',
      channelKind: 'email',
      channelId: null,
      externalId: null,
    };
  }
  const adapter = getAdapter(target.kind);
  if (!adapter.capabilities.supportsOutbound || !target.channel) {
    return await recordFailure(
      env,
      input,
      target.kind,
      target.channel?.id ?? null,
      'unsupported_outbound',
    );
  }
  const customerId = await loadCustomerId(env, input.workspaceId, input.ticketId);
  const preferenceCheck = await canDeliverTo(env, {
    workspaceId: input.workspaceId,
    customerId,
    channelKind: target.kind,
  });
  if (!preferenceCheck.allowed) {
    return await recordFailure(
      env,
      input,
      target.kind,
      target.channel.id,
      `preference_${preferenceCheck.reason ?? 'blocked'}`,
    );
  }
  const externalThreadId = await loadExternalThread(env, input.ticketId, target.kind);
  const message: EgressMessage = {
    ticketId: input.ticketId,
    messageId: input.messageId,
    externalThreadId,
    text: input.text,
    html: input.html ?? null,
    attachments: input.attachments,
    fromName: input.fromName ?? null,
  };
  try {
    const result = await adapter.egress(env, target.channel, message);
    await persistDispatch(env, input, target.kind, target.channel.id, 'delivered', null, result);
    return {
      status: 'delivered',
      channelKind: target.kind,
      channelId: target.channel.id,
      externalId: result.externalId,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_error';
    return await recordFailure(env, input, target.kind, target.channel.id, reason);
  }
}

async function resolveDispatchTarget(
  env: Env,
  input: DispatchInput,
): Promise<{ kind: ChannelKind; channel: PublicChannel | null } | null> {
  if (input.overrideChannelKind) {
    if (input.overrideChannelKind === 'email') {
      return { kind: 'email', channel: null };
    }
    if (!input.overrideChannelId) return null;
    const channel = await loadChannel(env, input.workspaceId, input.overrideChannelId);
    return channel ? { kind: channel.kind, channel } : null;
  }
  const ticket = await env.DB.prepare(
    `SELECT origin_channel_kind, origin_channel_id FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
    .bind(input.ticketId, input.workspaceId)
    .first<{ origin_channel_kind: ChannelKind; origin_channel_id: string | null }>();
  if (!ticket) return null;
  if (ticket.origin_channel_kind === 'email' || !ticket.origin_channel_id) {
    return { kind: 'email', channel: null };
  }
  const channel = await loadChannel(env, input.workspaceId, ticket.origin_channel_id);
  return channel ? { kind: channel.kind, channel } : null;
}

async function loadChannel(
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

async function loadCustomerId(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT customer_id FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
    .bind(ticketId, workspaceId)
    .first<{ customer_id: string | null }>();
  return row?.customer_id ?? null;
}

async function loadExternalThread(
  env: Env,
  ticketId: string,
  kind: ChannelKind,
): Promise<string | null> {
  // The external thread id is encoded into rfc_message_id when we ingest a
  // message from a threaded channel. Use the most recent inbound message
  // from this channel to know which thread to reply into.
  const row = await env.DB.prepare(
    `SELECT rfc_message_id FROM message_index
      WHERE ticket_id = ? AND direction = 'inbound' AND rfc_message_id LIKE ?
      ORDER BY sent_at DESC LIMIT 1`,
  )
    .bind(ticketId, `${kind}:%:thread:%`)
    .first<{ rfc_message_id: string }>();
  if (!row?.rfc_message_id) return null;
  const match = row.rfc_message_id.match(/^[^:]+:[^:]+:thread:([^:]+):/);
  return match ? match[1] : null;
}

async function persistDispatch(
  env: Env,
  input: DispatchInput,
  kind: ChannelKind,
  channelId: string | null,
  status: 'delivered' | 'failed',
  error: string | null,
  result: EgressResult | null,
): Promise<void> {
  const now = Date.now();
  // On failure, schedule a retry with exponential backoff (60s, 5m, 30m, 2h, 8h)
  // unless the error is a soft-block from preferences in which case we never
  // retry — the customer chose this state.
  const nextAttemptAt =
    status === 'failed' && !isPreferenceError(error) ? now + retryBackoffMs(1) : null;
  await env.DB.prepare(
    `INSERT INTO channel_outbound_dispatch
       (id, workspace_id, ticket_id, message_id, channel_kind, channel_id,
        status, attempts, last_error, external_id, next_attempt_at,
        max_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 5, ?, ?)`,
  )
    .bind(
      ids.channelDispatch(),
      input.workspaceId,
      input.ticketId,
      input.messageId,
      kind,
      channelId,
      status === 'failed' && nextAttemptAt ? 'pending' : status,
      error,
      result?.externalId ?? null,
      nextAttemptAt,
      now,
      now,
    )
    .run();
  if (result?.externalThreadId && channelId) {
    // Stamp the outbound message_index row with the external thread id so
    // future replies in the same conversation thread correctly.
    await env.DB.prepare(`UPDATE message_index SET rfc_message_id = ? WHERE id = ?`)
      .bind(
        `${kind}:${channelId}:thread:${result.externalThreadId}:${result.externalId ?? input.messageId}`,
        input.messageId,
      )
      .run();
  }
}

// Re-attempt a single pending dispatch row. Called by the retry sweep.
// Returns the new status — 'delivered' on success, 'failed' if max attempts
// reached, 'pending' if scheduled for another retry.
export async function retryPendingDispatch(
  env: Env,
  dispatchId: string,
): Promise<'delivered' | 'failed' | 'pending'> {
  const row = await env.DB.prepare(`SELECT * FROM channel_outbound_dispatch WHERE id = ?`)
    .bind(dispatchId)
    .first<{
      id: string;
      workspace_id: string;
      ticket_id: string;
      message_id: string;
      channel_kind: ChannelKind;
      channel_id: string | null;
      attempts: number;
      max_attempts: number;
      status: string;
    }>();
  if (!row || row.status !== 'pending') return 'failed';
  if (row.attempts >= row.max_attempts) {
    await env.DB.prepare(
      `UPDATE channel_outbound_dispatch
          SET status = 'failed', next_attempt_at = NULL, updated_at = ?
        WHERE id = ?`,
    )
      .bind(Date.now(), row.id)
      .run();
    return 'failed';
  }
  const message = await loadOutboundMessageText(env, row.workspace_id, row.message_id);
  if (!message) {
    await env.DB.prepare(
      `UPDATE channel_outbound_dispatch
          SET status = 'failed', last_error = 'message_body_missing', next_attempt_at = NULL,
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(Date.now(), row.id)
      .run();
    return 'failed';
  }
  const adapter = getAdapter(row.channel_kind);
  const channel = row.channel_id ? await loadChannel(env, row.workspace_id, row.channel_id) : null;
  if (!channel) {
    await env.DB.prepare(
      `UPDATE channel_outbound_dispatch
          SET status = 'failed', last_error = 'channel_missing', next_attempt_at = NULL,
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(Date.now(), row.id)
      .run();
    return 'failed';
  }
  const attempts = row.attempts + 1;
  try {
    const result = await adapter.egress(env, channel, {
      ticketId: row.ticket_id,
      messageId: row.message_id,
      externalThreadId: await loadExternalThread(env, row.ticket_id, row.channel_kind),
      text: message,
    });
    await env.DB.prepare(
      `UPDATE channel_outbound_dispatch
          SET status = 'delivered', attempts = ?, external_id = ?, last_error = NULL,
              next_attempt_at = NULL, updated_at = ?
        WHERE id = ?`,
    )
      .bind(attempts, result.externalId ?? null, Date.now(), row.id)
      .run();
    return 'delivered';
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_error';
    if (attempts >= row.max_attempts) {
      await env.DB.prepare(
        `UPDATE channel_outbound_dispatch
            SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = NULL,
                updated_at = ?
          WHERE id = ?`,
      )
        .bind(attempts, reason, Date.now(), row.id)
        .run();
      return 'failed';
    }
    await env.DB.prepare(
      `UPDATE channel_outbound_dispatch
          SET attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(attempts, reason, Date.now() + retryBackoffMs(attempts), Date.now(), row.id)
      .run();
    return 'pending';
  }
}

async function loadOutboundMessageText(
  env: Env,
  workspaceId: string,
  messageId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT body_r2_key FROM message_index WHERE id = ? AND workspace_id = ?`,
  )
    .bind(messageId, workspaceId)
    .first<{ body_r2_key: string | null }>();
  if (!row?.body_r2_key) return null;
  const obj = await env.BLOB.get(row.body_r2_key);
  if (!obj) return null;
  return await obj.text();
}

export function retryBackoffMs(attempt: number): number {
  // 60s, 5m, 30m, 2h, 8h with ±10% jitter.
  const base = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000];
  const idx = Math.min(Math.max(attempt - 1, 0), base.length - 1);
  const jitter = 1 + (Math.random() - 0.5) * 0.2;
  return Math.round(base[idx] * jitter);
}

function isPreferenceError(error: string | null): boolean {
  return !!error && error.startsWith('preference_');
}

async function recordFailure(
  env: Env,
  input: DispatchInput,
  kind: ChannelKind,
  channelId: string | null,
  reason: string,
): Promise<DispatchOutcome> {
  await persistDispatch(env, input, kind, channelId, 'failed', reason, null);
  return {
    status: 'failed',
    channelKind: kind,
    channelId,
    externalId: null,
    error: reason,
  };
}

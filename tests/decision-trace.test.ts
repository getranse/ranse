import { describe, expect, it } from 'vitest';
import {
  buildPublicTrace,
  buildTraceLink,
  verifyTraceToken,
} from '../src/server/lib/decision-trace';
import { renderTracePage } from '../src/server/lib/decision-trace-page';
import { createWorkspaceTestDb, seedMailbox, seedWorkspace } from './helpers/workspace-db';

function seedTicket(db: any, ticketId: string, workspaceId: string, mailboxId: string) {
  db.prepare(
    `INSERT INTO ticket (
      id, workspace_id, mailbox_id, subject, last_message_at, requester_email,
      thread_token, created_at, updated_at, origin_channel_kind
    ) VALUES (?, ?, ?, 'Refund', 1, 'a@example.com', 'tok', 1, 1, 'email')`,
  ).run(ticketId, workspaceId, mailboxId);
}

function seedAiMessage(db: any, workspaceId: string, ticketId: string, messageId: string) {
  db.prepare(
    `INSERT INTO message_index (
      id, workspace_id, ticket_id, direction, rfc_message_id, sent_at, created_at,
      author_user_id, preview
    ) VALUES (?, ?, ?, 'outbound', ?, 1, 1, NULL, 'hi')`,
  ).run(messageId, workspaceId, ticketId, `${messageId}@example.com`);
}

const ENV_BASE = { APP_URL: 'https://support.example.com', COOKIE_SIGNING_KEY: 'test-secret' };

describe('decision trace', () => {
  it('signs and verifies a trace token round-trip', async () => {
    const { env } = createWorkspaceTestDb();
    const url = await buildTraceLink({ ...env, ...ENV_BASE } as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      messageId: 'msg_1',
    });
    expect(url).toMatch(/^https:\/\/support\.example\.com\/public\/trace\//);
    const token = url!.split('/public/trace/')[1];
    const payload = await verifyTraceToken({ ...env, ...ENV_BASE } as any, token);
    expect(payload?.ticketId).toBe('tkt_1');
    expect(payload?.messageId).toBe('msg_1');
  });

  it('rejects tampered tokens', async () => {
    const { env } = createWorkspaceTestDb();
    const url = await buildTraceLink({ ...env, ...ENV_BASE } as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      messageId: 'msg_1',
    });
    const token = url!.split('/public/trace/')[1];
    const [payload, sig] = token.split('.');
    const bad = `${payload}.${'0'.repeat(sig.length)}`;
    const verified = await verifyTraceToken({ ...env, ...ENV_BASE } as any, bad);
    expect(verified).toBeNull();
  });

  it('returns null when APP_URL is not configured', async () => {
    const { env } = createWorkspaceTestDb();
    const url = await buildTraceLink(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      messageId: 'msg_1',
    });
    expect(url).toBeNull();
  });

  it('builds a public trace from message + audit + procedure rows', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');
    seedAiMessage(db, 'ws_a', 'tkt_1', 'msg_1');
    // Audit event for the AI-authored reply with citations.
    db.prepare(
      `INSERT INTO audit_event (id, workspace_id, ticket_id, actor_type, action, payload_json, created_at)
       VALUES ('aud_1', 'ws_a', 'tkt_1', 'agent', 'reply.auto_sent', ?, 1)`,
    ).run(
      JSON.stringify({
        messageId: 'msg_1',
        reason: 'High confidence policy match',
        citesKnowledgeIds: [],
        components: { draftConfidence: 0.92 },
      }),
    );

    const trace = await buildPublicTrace(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      messageId: 'msg_1',
      expiresAt: Date.now() + 60_000,
    });
    expect(trace).not.toBeNull();
    expect(trace?.workspaceLabel).toBe('Alpha');
    expect(trace?.channel).toBe('email');
    expect(trace?.confidence).toBeCloseTo(0.92);
    expect(trace?.reasonSummary).toContain('High confidence policy match');
  });

  it('refuses to surface a trace for human-authored messages', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');
    db.prepare(
      `INSERT INTO message_index (
        id, workspace_id, ticket_id, direction, rfc_message_id, sent_at, created_at,
        author_user_id
      ) VALUES ('msg_h', 'ws_a', 'tkt_1', 'outbound', 'h@e.com', 1, 1, 'usr_1')`,
    ).run();
    const trace = await buildPublicTrace(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      messageId: 'msg_h',
      expiresAt: Date.now() + 60_000,
    });
    expect(trace).toBeNull();
  });

  it('renders an HTML page without leaking internals', async () => {
    const html = renderTracePage({
      workspaceLabel: 'Alpha',
      authoredAt: Date.UTC(2026, 0, 1),
      channel: 'email',
      kbSources: [{ title: 'Refund policy', url: 'https://help.example.com/refunds', last_refreshed_at: 1 }],
      procedure: { name: 'refund-intake', version: '1.0.0' },
      mcpCalls: [
        { label: 'stripe.customers.search', read_only: true, status: 'completed', approved_by_human: false },
      ],
      confidence: 0.91,
      approver: 'usr_1',
      evalPassRate: 0.95,
      reasonSummary: 'Followed the "refund-intake" procedure. Cited 1 knowledge source.',
    });
    expect(html).toContain('Why this answer?');
    expect(html).toContain('refund-intake');
    expect(html).toContain('Refund policy');
    expect(html).toContain('stripe.customers.search');
    // Internal procedure step IDs and message ids never appear.
    expect(html).not.toContain('msg_');
    expect(html).not.toContain('step_');
  });
});

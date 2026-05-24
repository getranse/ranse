import { describe, expect, it } from 'vitest';
import {
  computeHonestResolutionMetrics,
  enqueueVerification,
  rejectVerification,
  sweepDueVerifications,
} from '../src/insights/honest-resolution';
import { recordOutcome, recordTicketFeedback } from '../src/lib/outcomes';
import { VERIFICATION_WINDOW_MS } from '../src/types/honest-resolution';
import { createWorkspaceTestDb, seedMailbox, seedWorkspace } from './helpers/workspace-db';

function seedTicket(db: any, ticketId: string, workspaceId: string, mailboxId: string) {
  db.prepare(
    `INSERT INTO ticket (
      id, workspace_id, mailbox_id, subject, last_message_at, requester_email,
      thread_token, created_at, updated_at
    ) VALUES (?, ?, ?, 'Refund', 1, 'a@example.com', 'tok', 1, 1)`,
  ).run(ticketId, workspaceId, mailboxId);
}

describe('honest resolution', () => {
  it('enqueues a pending verification on AI authorship and verifies after window close', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');

    const id = await enqueueVerification(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      aiMessageId: 'msg_1',
      source: 'autonomous',
    });
    expect(id).not.toBeNull();
    const row = db
      .prepare(`SELECT status, window_closes_at FROM verified_resolution WHERE id = ?`)
      .get(id) as any;
    expect(row.status).toBe('pending');
    // Force the window closed and run the sweep.
    db.prepare(`UPDATE verified_resolution SET window_closes_at = 1 WHERE id = ?`).run(id);
    const result = await sweepDueVerifications(env as any, { now: 10 });
    expect(result.verified).toBe(1);
    const updated = db
      .prepare(`SELECT status, verified_at FROM verified_resolution WHERE id = ?`)
      .get(id) as any;
    expect(updated.status).toBe('verified');
    expect(updated.verified_at).toBe(10);
  });

  it('is idempotent — a second enqueue on the same ticket does not open a new window', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');

    const id1 = await enqueueVerification(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      aiMessageId: 'msg_1',
      source: 'autonomous',
    });
    const id2 = await enqueueVerification(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      aiMessageId: 'msg_2',
      source: 'procedure',
    });
    expect(id1).not.toBeNull();
    expect(id2).toBeNull();
    const rows = db
      .prepare(`SELECT COUNT(*) AS n FROM verified_resolution WHERE ticket_id = 'tkt_1'`)
      .get() as any;
    expect(rows.n).toBe(1);
  });

  it('rejects on human takeover signal', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');

    await enqueueVerification(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      aiMessageId: 'msg_1',
      source: 'autonomous',
    });
    const ok = await rejectVerification(env as any, 'ws_a', 'tkt_1', 'human_takeover');
    expect(ok).toBe(true);
    const row = db
      .prepare(`SELECT status, rejection_reason FROM verified_resolution WHERE ticket_id = 'tkt_1'`)
      .get() as any;
    expect(row.status).toBe('rejected');
    expect(row.rejection_reason).toBe('human_takeover');
  });

  it('rejects on follow-up outcome routed through recordOutcome', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');

    await enqueueVerification(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      aiMessageId: 'msg_1',
      source: 'autonomous',
    });
    await recordOutcome(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      kind: 'customer_followed_up',
      source: 'system',
    });
    const row = db
      .prepare(`SELECT status, rejection_reason FROM verified_resolution WHERE ticket_id = 'tkt_1'`)
      .get() as any;
    expect(row.status).toBe('rejected');
    expect(row.rejection_reason).toBe('follow_up');
  });

  it('rejects on negative feedback', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');

    await enqueueVerification(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      aiMessageId: 'msg_1',
      source: 'autonomous',
    });
    await recordTicketFeedback(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      rating: 'negative',
    });
    const row = db
      .prepare(`SELECT status, rejection_reason FROM verified_resolution WHERE ticket_id = 'tkt_1'`)
      .get() as any;
    expect(row.status).toBe('rejected');
    expect(row.rejection_reason).toBe('negative_feedback');
  });

  it('rejection is idempotent — first reason wins', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');

    await enqueueVerification(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      aiMessageId: 'msg_1',
      source: 'autonomous',
    });
    await rejectVerification(env as any, 'ws_a', 'tkt_1', 'human_takeover');
    const ok = await rejectVerification(env as any, 'ws_a', 'tkt_1', 'follow_up');
    expect(ok).toBe(false);
    const row = db
      .prepare(`SELECT rejection_reason FROM verified_resolution WHERE ticket_id = 'tkt_1'`)
      .get() as any;
    expect(row.rejection_reason).toBe('human_takeover');
  });

  it('exposes both honest and fin-style rates with rejection breakdown', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    // Three tickets in window: one verified, one rejected for follow-up, one rejected for takeover.
    for (let i = 1; i <= 3; i += 1) seedTicket(db, `tkt_${i}`, 'ws_a', 'mb_a');
    const now = Date.now();
    for (let i = 1; i <= 3; i += 1) {
      await enqueueVerification(env as any, {
        workspaceId: 'ws_a',
        ticketId: `tkt_${i}`,
        aiMessageId: `msg_${i}`,
        source: 'autonomous',
        authoredAt: now - 24 * 60 * 60_000,
      });
    }
    await rejectVerification(env as any, 'ws_a', 'tkt_2', 'follow_up');
    await rejectVerification(env as any, 'ws_a', 'tkt_3', 'human_takeover');
    // Force tkt_1's window closed and sweep.
    db.prepare(`UPDATE verified_resolution SET window_closes_at = 1 WHERE ticket_id = 'tkt_1'`)
      .run();
    await sweepDueVerifications(env as any, { now: now });

    const metrics = await computeHonestResolutionMetrics(env as any, 'ws_a', {
      windowDays: 7,
      now,
    });
    expect(metrics.aiAuthoredCount).toBe(3);
    expect(metrics.verifiedCount).toBe(1);
    expect(metrics.rejectedCount).toBe(2);
    expect(metrics.rejectionBreakdown.human_takeover).toBe(1);
    expect(metrics.rejectionBreakdown.follow_up).toBe(1);
    // Honest = 1 / 3
    expect(metrics.honestResolutionRate).toBeCloseTo(1 / 3, 4);
    // Fin-style: verified + pending + follow_up = 1 + 0 + 1 = 2 out of 3
    expect(metrics.finStyleRate).toBeCloseTo(2 / 3, 4);
    // Gap shows up
    expect(metrics.finStyleRate - metrics.honestResolutionRate).toBeGreaterThan(0);
  });

  it('uses the documented 7-day window length', () => {
    expect(VERIFICATION_WINDOW_MS).toBe(7 * 24 * 60 * 60_000);
  });
});

import { describe, expect, it } from 'vitest';
import {
  computeOutcomeStatement,
  loadPricing,
  priceBookFromRow,
  recordLedgerEntry,
  savePricing,
} from '../src/server/billing/outcomes';
import { recordOutcome } from '../src/server/outcomes';
import {
  enqueueVerification,
  sweepDueVerifications,
} from '../src/server/insights/honest-resolution';
import { DEFAULT_PRICE_BOOK } from '../src/types/billing';
import { createWorkspaceTestDb, seedMailbox, seedWorkspace } from './helpers/workspace-db';

function seedTicket(db: any, ticketId: string, workspaceId: string, mailboxId: string) {
  db.prepare(
    `INSERT INTO ticket (
      id, workspace_id, mailbox_id, subject, last_message_at, requester_email,
      thread_token, created_at, updated_at
    ) VALUES (?, ?, ?, 'Refund', 1, 'a@example.com', 'tok', 1, 1)`,
  ).run(ticketId, workspaceId, mailboxId);
}

describe('outcome pricing instrument', () => {
  it('returns default price book when no row exists', async () => {
    const { env } = createWorkspaceTestDb();
    const row = await loadPricing(env as any, 'ws_a');
    expect(row.workspace_id).toBe('ws_a');
    expect(priceBookFromRow(row)).toEqual(DEFAULT_PRICE_BOOK);
  });

  it('saves and merges price book overrides', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const saved = await savePricing(env as any, 'ws_a', {
      priceBook: { verified_resolution: 2500 },
      actorUserId: 'usr_1',
    });
    expect(priceBookFromRow(saved).verified_resolution).toBe(2500);
    // Other defaults preserved.
    expect(priceBookFromRow(saved).follow_up_cost).toBe(DEFAULT_PRICE_BOOK.follow_up_cost);
  });

  it('records signed ledger entries from outcome events', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');

    await recordOutcome(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      kind: 'resolved_autonomously',
      source: 'agent',
    });
    await recordOutcome(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      kind: 'customer_followed_up',
      source: 'system',
    });

    const rows = db
      .prepare(`SELECT kind, amount_cents FROM outcome_ledger_entry WHERE workspace_id = 'ws_a'
                ORDER BY created_at ASC`)
      .all();
    expect(rows).toEqual([
      { kind: 'autonomous_resolution', amount_cents: DEFAULT_PRICE_BOOK.autonomous_resolution },
      { kind: 'follow_up_cost', amount_cents: DEFAULT_PRICE_BOOK.follow_up_cost },
    ]);
  });

  it('records a verified_resolution entry when sweep promotes pending', async () => {
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
    db.prepare(`UPDATE verified_resolution SET window_closes_at = 1 WHERE id = ?`).run(id);
    await sweepDueVerifications(env as any, { now: 10 });
    const row = db
      .prepare(`SELECT kind, amount_cents FROM outcome_ledger_entry WHERE kind = 'verified_resolution'`)
      .get() as any;
    expect(row.amount_cents).toBe(DEFAULT_PRICE_BOOK.verified_resolution);
  });

  it('computes a statement with value, cost, and Fin comparison', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');
    seedTicket(db, 'tkt_2', 'ws_a', 'mb_a');
    seedTicket(db, 'tkt_3', 'ws_a', 'mb_a');

    const now = Date.now();
    // Two pending + one verified verifications. Fin would count all three.
    for (const t of ['tkt_1', 'tkt_2', 'tkt_3']) {
      await enqueueVerification(env as any, {
        workspaceId: 'ws_a',
        ticketId: t,
        aiMessageId: `msg_${t}`,
        source: 'autonomous',
        authoredAt: now - 1000,
      });
    }
    db.prepare(`UPDATE verified_resolution SET window_closes_at = 1 WHERE ticket_id = 'tkt_1'`)
      .run();
    await sweepDueVerifications(env as any, { now });

    // Add a follow_up_cost manually to make sure costs sum.
    await recordLedgerEntry(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_2',
      kind: 'follow_up_cost',
    });

    // Use a "now" after all the ledger entries were written so they fall inside
    // the statement window — Date.now() during the test runs ahead of the
    // captured `now` we used to enqueue.
    const statement = await computeOutcomeStatement(env as any, 'ws_a', {
      windowDays: 30,
      now: Date.now() + 1000,
    });
    expect(statement.verifiedResolutionCount).toBe(1);
    // One verified_resolution credit at +1500
    expect(statement.valueCents).toBeGreaterThanOrEqual(DEFAULT_PRICE_BOOK.verified_resolution);
    // One follow_up_cost at -300 → cost is 300
    expect(statement.costCents).toBeGreaterThanOrEqual(-DEFAULT_PRICE_BOOK.follow_up_cost);
    // Fin would bill 3 × 99¢ = $2.97
    expect(statement.finComparisonCents).toBe(3 * 99);
    // Cost per verified is total cost / 1
    expect(statement.costPerVerifiedResolution).toBe(statement.costCents);
    // Statement currency comes from pricing row
    expect(statement.currency).toBe('USD');
  });

  it('does not record zero-priced kinds', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');
    const entry = await recordLedgerEntry(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      kind: 'inference_cost', // Default is 0
    });
    expect(entry).toBeNull();
    const rows = db
      .prepare(`SELECT COUNT(*) AS n FROM outcome_ledger_entry`)
      .get() as any;
    expect(rows.n).toBe(0);
  });

  it('honors explicit override even when default is zero', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, 'tkt_1', 'ws_a', 'mb_a');
    const entry = await recordLedgerEntry(env as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      kind: 'inference_cost',
      amountCentsOverride: -42,
    });
    expect(entry).not.toBeNull();
    expect(entry?.amount_cents).toBe(-42);
  });
});

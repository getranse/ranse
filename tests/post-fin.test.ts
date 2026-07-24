import { describe, expect, it, vi } from 'vitest';
import '../src/server/inbox/channels';
import { layoutProcedure } from '../src/lib/procedure-diagram';
import { ingestExtractedFacts, listMemory, redactMemory } from '../src/server/actions/memory';
import { computeOperationsMetrics } from '../src/server/platform/insights/operations';
import type { ProcedureSpec } from '../src/types/shared/procedures';
import {
  addMember,
  createWorkspaceTestDb,
  seedMailbox,
  seedUser,
  seedWorkspace,
} from './helpers/workspace-db';

vi.mock('agents', () => ({
  getAgentByName: () => ({ start: async () => undefined, resume: async () => undefined }),
  Agent: class {},
  callable: () => () => undefined,
  routeAgentRequest: () => null,
}));

async function setup() {
  const { db, env } = createWorkspaceTestDb();
  await seedUser(db, 'owner', 'owner@example.com');
  seedWorkspace(db, 'ws_a', 'Alpha');
  addMember(db, 'ws_a', 'owner', 'owner');
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO customer (id, workspace_id, display_name, primary_email, primary_phone, created_at, updated_at)
     VALUES ('cust_a', 'ws_a', 'Ada', 'ada@example.com', NULL, 1, 1)`,
  ).run();
  return { db, env };
}

describe('customer memory store', () => {
  it('dedupes facts by evidence hash and bumps confidence on repeat', async () => {
    const { env } = await setup();
    const first = await ingestExtractedFacts(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      sourceTicketId: 'tkt_1',
      facts: [{ kind: 'fact', text: 'On the Enterprise plan since 2024.', confidence: 0.7 }],
    });
    const second = await ingestExtractedFacts(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      sourceTicketId: 'tkt_2',
      facts: [{ kind: 'fact', text: 'On the Enterprise plan since 2024.', confidence: 0.9 }],
    });
    expect(first[0]?.id).toBe(second[0]?.id);
    const list = await listMemory(env as never, 'ws_a', 'cust_a');
    expect(list).toHaveLength(1);
    expect(list[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('drops facts below the confidence floor', async () => {
    const { env } = await setup();
    const ingested = await ingestExtractedFacts(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      sourceTicketId: 'tkt_1',
      facts: [
        { kind: 'fact', text: 'Maybe interested in onboarding help.', confidence: 0.2 },
        { kind: 'preference', text: 'Prefers email replies over SMS.', confidence: 0.85 },
      ],
    });
    expect(ingested).toHaveLength(1);
    expect(ingested[0].kind).toBe('preference');
  });

  it('redaction hides rows from listMemory but keeps them in the table', async () => {
    const { db, env } = await setup();
    const [memory] = await ingestExtractedFacts(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      sourceTicketId: 'tkt_1',
      facts: [{ kind: 'fact', text: 'Lives in Tokyo.', confidence: 0.9 }],
    });
    await redactMemory(env as never, 'ws_a', memory.id, 'operator-requested');
    const visible = await listMemory(env as never, 'ws_a', 'cust_a');
    expect(visible).toHaveLength(0);
    const rawCount = db.prepare(`SELECT COUNT(*) AS n FROM customer_memory`).get() as { n: number };
    expect(rawCount.n).toBe(1);
  });
});

describe('operations metrics', () => {
  it('computes resolution + deflection + csat + ttfr from synthetic activity', async () => {
    const { db, env } = await setup();
    const now = Date.now();
    const minute = 60_000;
    // Three tickets in the window.
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, status, priority, requester_email, last_message_at, thread_token, origin_channel_kind, customer_id, created_at, updated_at)
       VALUES
         ('tkt_a', 'ws_a', 'mb_a', 'A', 'resolved', 'normal', 'ada@example.com', ?, 'th_a', 'email', 'cust_a', ?, ?),
         ('tkt_b', 'ws_a', 'mb_a', 'B', 'resolved', 'normal', 'b@example.com',   ?, 'th_b', 'sms',   NULL,     ?, ?),
         ('tkt_c', 'ws_a', 'mb_a', 'C', 'open',     'normal', 'c@example.com',   ?, 'th_c', 'email', NULL,     ?, ?)`,
    ).run(now, now - 5 * minute, now, now, now - 4 * minute, now, now, now - 3 * minute, now);
    // tkt_a was handled by a human (author_user_id NOT NULL).
    db.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, from_address, to_address, subject, preview, has_attachments, author_user_id, sent_at, created_at)
       VALUES
         ('msg_a1', 'tkt_a', 'ws_a', 'outbound', 'support@example.com', 'ada@example.com', 'Re: A', 'human reply', 0, 'owner', ?, ?),
         ('msg_b1', 'tkt_b', 'ws_a', 'outbound', 'support@example.com', 'b@example.com',   'Re: B', 'auto reply',  0, NULL,    ?, ?)`,
    ).run(now - 4 * minute, now, now - 2 * minute, now);
    db.prepare(
      `INSERT INTO ticket_feedback (id, workspace_id, ticket_id, message_id, rating, source, created_at)
       VALUES
         ('fb_a', 'ws_a', 'tkt_a', 'msg_a1', 'positive', 'agent', ?),
         ('fb_b', 'ws_a', 'tkt_b', 'msg_b1', 'positive', 'agent', ?),
         ('fb_c', 'ws_a', 'tkt_c', NULL,     'negative', 'agent', ?)`,
    ).run(now, now, now);

    const metrics = await computeOperationsMetrics(env as never, 'ws_a', { windowDays: 30 });
    expect(metrics.volume.total).toBe(3);
    expect(metrics.resolution.rate).toBeCloseTo(2 / 3, 5);
    expect(metrics.deflection.autonomousResolved).toBe(1); // tkt_b
    expect(metrics.deflection.humanResolved).toBe(1); // tkt_a
    expect(metrics.satisfaction.csatScore).toBeCloseTo((2 - 1) / 3, 5);
    expect(metrics.responseTime.ttfrMedianMs).not.toBeNull();
    expect(metrics.responseTime.ttfrMedianMs!).toBeGreaterThan(0);
  });

  it('returns null csat when there is no feedback in the window', async () => {
    const { env } = await setup();
    const metrics = await computeOperationsMetrics(env as never, 'ws_a', { windowDays: 30 });
    expect(metrics.satisfaction.csatScore).toBeNull();
  });
});

describe('procedure flow diagram', () => {
  it('lays out a simple linear procedure as start → step → end', () => {
    const spec: ProcedureSpec = {
      slug: 's',
      name: 'S',
      version: '1',
      trigger: { type: 'manual' },
      steps: [{ id: 'note', type: 'add_note', body: 'hi' }],
    };
    const diagram = layoutProcedure(spec);
    expect(diagram.nodes.map((n) => n.shape)).toEqual(['terminal', 'process', 'terminal']);
    expect(diagram.edges).toHaveLength(2);
    expect(diagram.height).toBeGreaterThan(0);
  });

  it('renders an if/else branch with yes/no labels and rejoins at the next step', () => {
    const spec: ProcedureSpec = {
      slug: 's',
      name: 'S',
      version: '1',
      trigger: { type: 'manual' },
      steps: [
        {
          id: 'gate',
          type: 'if',
          condition: { var: 'ok', equals: true },
          // biome-ignore lint/suspicious/noThenProperty: Procedure DSL uses if/then/else.
          then: [{ id: 'a', type: 'add_note', body: 'yes' }],
          else: [{ id: 'b', type: 'add_note', body: 'no' }],
        },
      ],
    };
    const diagram = layoutProcedure(spec);
    const decision = diagram.nodes.find((n) => n.shape === 'decision');
    expect(decision).toBeDefined();
    const labeled = diagram.edges.filter((e) => e.label);
    expect(labeled.map((e) => e.label).sort()).toEqual(['no', 'yes']);
    // Both branch exits should funnel into the End node.
    const endNode = diagram.nodes.find((n) => n.label === 'End');
    expect(endNode).toBeDefined();
    const incomingToEnd = diagram.edges.filter((e) => e.toId === endNode!.id);
    expect(incomingToEnd.length).toBe(2);
  });

  it('renders call_action with the requires_approval flag', () => {
    const spec: ProcedureSpec = {
      slug: 's',
      name: 'S',
      version: '1',
      trigger: { type: 'manual' },
      steps: [
        {
          id: 'refund',
          type: 'call_action',
          tool: 'stripe.refunds.create',
          args: { charge_id: 'ch_1' },
          requires_approval: true,
        },
      ],
    };
    const diagram = layoutProcedure(spec);
    const action = diagram.nodes.find((n) => n.label.startsWith('call '));
    expect(action?.approvalGate).toBe(true);
    expect(action?.sublabel).toBe('requires approval');
  });
});

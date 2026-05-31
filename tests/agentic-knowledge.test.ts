import { describe, expect, it, vi } from 'vitest';
import { agenticSearchKnowledge, searchProcedurePrimitive } from '../src/server/automation/knowledge';
import { createKnowledgeTestDb } from './helpers/knowledge-db';

function seedPolicy(
  db: ReturnType<typeof createKnowledgeTestDb>,
  id: string,
  body: string,
  kind: 'manual' | 'resolved_ticket' = 'manual',
) {
  db.insertSource({ id: `${id}_source`, title: `${id} source`, kind });
  db.insertChunk({ id: `${id}_chunk`, sourceId: `${id}_source`, title: `${id} policy`, body });
}

describe('agenticSearchKnowledge', () => {
  it('runs bounded multi-hop retrieval and returns an inspection trace', async () => {
    const db = createKnowledgeTestDb();
    seedPolicy(db, 'refund', 'Refund policy allows refunds within 30 days.');
    seedPolicy(db, 'warranty', 'Warranty policy covers replacement for one year.');

    const result = await agenticSearchKnowledge(
      db.env as any,
      'ws_1',
      'Can I get a refund and warranty help?',
      {
        limit: 5,
        planner: async () => ({
          originalQuery: '',
          scope: 'knowledge',
          subqueries: ['refund policy', 'warranty policy'],
          maxHops: 2,
        }),
        judge: async ({ hop }) =>
          hop === 1
            ? {
                sufficient: false,
                reasoning: 'Need warranty evidence.',
                missing: ['warranty'],
                nextQuery: 'warranty policy',
              }
            : { sufficient: true, reasoning: 'Refund and warranty evidence found.', missing: [] },
      },
    );

    expect(result.trace.finalAnswerable).toBe(true);
    expect(result.trace.stopReason).toBe('sufficient');
    expect(result.trace.plan.source).toBe('injected');
    expect(typeof result.trace.durationMs).toBe('number');
    expect(typeof result.trace.hops[0].searchMs).toBe('number');
    expect(result.trace.hops[0].judgment.source).toBe('injected');
    expect(result.trace.hops.map((hop) => hop.query)).toEqual(['refund policy', 'warranty policy']);
    expect(new Set(result.hits.map((hit) => hit.id))).toEqual(
      new Set(['refund_chunk', 'warranty_chunk']),
    );
  });

  it('honors resolved-ticket scope without leaking regular knowledge sources', async () => {
    const db = createKnowledgeTestDb();
    seedPolicy(db, 'manual_refund', 'Refund policy from the manual knowledge base.', 'manual');
    seedPolicy(
      db,
      'resolved_refund',
      'Refund policy from a resolved customer ticket.',
      'resolved_ticket',
    );

    const result = await agenticSearchKnowledge(db.env as any, 'ws_1', 'refund policy', {
      planner: async () => ({
        originalQuery: '',
        scope: 'resolved_tickets',
        subqueries: ['refund policy'],
        maxHops: 1,
      }),
      judge: async () => ({
        sufficient: true,
        reasoning: 'Resolved ticket evidence found.',
        missing: [],
      }),
    });

    expect(result.hits.map((hit) => hit.id)).toEqual(['resolved_refund_chunk']);
    expect(result.trace.hops[0].scope).toBe('resolved_tickets');
  });

  it('fails closed for customer-data scope until a connector is attached', async () => {
    const db = createKnowledgeTestDb();
    const judge = vi.fn();

    const result = await agenticSearchKnowledge(
      db.env as any,
      'ws_1',
      'What plan is this customer on?',
      {
        planner: async () => ({
          originalQuery: '',
          scope: 'customer_data',
          subqueries: ['customer plan'],
          maxHops: 3,
        }),
        judge,
      },
    );

    expect(judge).not.toHaveBeenCalled();
    expect(result.hits).toEqual([]);
    expect(result.trace.stopReason).toBe('no_hits');
    expect(result.trace.hops[0].judgment.missing).toEqual(['customer data connector']);
    expect(result.trace.hops[0].judgment.source).toBe('system');
  });

  it('normalizes unsafe planner output and refuses answerable traces without evidence', async () => {
    const db = createKnowledgeTestDb();

    const result = await agenticSearchKnowledge(db.env as any, 'ws_1', 'missing refund policy', {
      planner: async () =>
        ({
          originalQuery: '',
          scope: 'not_a_scope',
          subqueries: ['missing refund', 'missing refund', ''],
          maxHops: 99,
        }) as any,
      judge: async () => ({ sufficient: true, reasoning: 'Enough.', missing: [] }),
    });

    expect(result.trace.plan.scope).toBe('all');
    expect(result.trace.plan.maxHops).toBe(5);
    expect(result.trace.plan.subqueries).toEqual(['missing refund', 'missing refund policy']);
    expect(result.trace.finalAnswerable).toBe(false);
    expect(result.trace.stopReason).toBe('no_hits');
    expect(result.trace.hops.every((hop) => hop.judgment.sufficient === false)).toBe(true);
    expect(result.trace.hops.at(-1)?.judgment.missing).toContain('supporting evidence');
  });

  it('exposes search as a procedure primitive', async () => {
    const db = createKnowledgeTestDb();
    seedPolicy(db, 'refund', 'Refund policy allows refunds within 30 days.');
    const env = {
      ...db.env,
      AI: {
        run: async () => ({
          response: '{"scope":"knowledge","subqueries":["refund policy"],"max_hops":1}',
        }),
      },
    };

    const result = await searchProcedurePrimitive(env as any, 'ws_1', {
      query: 'refund policy',
      scope: 'knowledge',
      max_hops: 1,
      limit: 1,
    });

    expect(result.hits.map((hit) => hit.id)).toEqual(['refund_chunk']);
    expect(result.trace.plan.maxHops).toBe(1);
    expect(result.trace.hops.map((hop) => hop.query)).toEqual(['refund policy']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/server/http/api/routes';
import {
  acceptKbSuggestion,
  detectKnowledgeDrift,
  generateKbSuggestions,
  getInsightSummary,
  pruneConversationScores,
  runAllWorkspaceInsightsMaintenance,
  scoreConversation,
  updateKbSuggestionStatus,
} from '../src/server/platform/insights';
import {
  addMember,
  createWorkspaceTestDb,
  login,
  seedMailbox,
  seedUser,
  seedWorkspace,
} from './helpers/workspace-db';

vi.mock('agents', () => ({
  getAgentByName: () => ({}),
  Agent: class {},
  callable: () => () => undefined,
}));

function seedTicket(
  db: ReturnType<typeof createWorkspaceTestDb>['db'],
  patch: Partial<{
    id: string;
    status: string;
    subject: string;
    category: string | null;
    now: number;
  }> = {},
) {
  const now = patch.now ?? Date.now();
  db.prepare(
    `INSERT INTO ticket (
       id, workspace_id, mailbox_id, subject, status, priority, category, last_message_at,
       requester_email, thread_token, created_at, updated_at
     ) VALUES (?, 'ws_a', 'mb_a', ?, ?, 'normal', ?, ?, 'customer@example.com', ?, ?, ?)`,
  ).run(
    patch.id ?? 'tkt_1',
    patch.subject ?? 'Refund request',
    patch.status ?? 'open',
    patch.category ?? null,
    now,
    `tok_${patch.id ?? 'tkt_1'}`,
    now,
    now,
  );
}

function seedMessage(
  db: ReturnType<typeof createWorkspaceTestDb>['db'],
  input: {
    id: string;
    ticketId: string;
    direction: 'inbound' | 'outbound';
    preview: string;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO message_index (
       id, ticket_id, workspace_id, direction, preview, sent_at, created_at
     ) VALUES (?, ?, 'ws_a', ?, ?, ?, ?)`,
  ).run(input.id, input.ticketId, input.direction, input.preview, now, now);
}

describe('insights', () => {
  it('scores conversations and aggregates workspace insight metrics', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, { id: 'tkt_score', status: 'resolved', category: 'billing' });
    seedMessage(db, {
      id: 'msg_in',
      ticketId: 'tkt_score',
      direction: 'inbound',
      preview: 'Can I get a refund?',
    });
    seedMessage(db, {
      id: 'msg_out',
      ticketId: 'tkt_score',
      direction: 'outbound',
      preview: 'Thanks for reaching out. I can help with that refund.',
    });
    db.prepare(
      `INSERT INTO approval_request (
        id, workspace_id, ticket_id, kind, status, proposed_json, risk_reasons_json, created_at
      ) VALUES ('apr_1', 'ws_a', 'tkt_score', 'draft_reply', 'approved', ?, '[]', ?)`,
    ).run(
      JSON.stringify({
        confidence: 0.96,
        cites_knowledge_ids: ['kchk_refund'],
        knowledge_hits: [{ id: 'kchk_refund' }],
        knowledge_trace: { finalAnswerable: true },
      }),
      Date.now(),
    );
    db.prepare(
      `INSERT INTO ticket_outcome_event (
        id, workspace_id, ticket_id, kind, source, payload_json, created_at
      ) VALUES ('out_1', 'ws_a', 'tkt_score', 'resolved_autonomously', 'agent', '{}', ?)`,
    ).run(Date.now());
    db.prepare(
      `INSERT INTO ticket_feedback (
        id, workspace_id, ticket_id, rating, source, created_at
      ) VALUES ('fb_1', 'ws_a', 'tkt_score', 'positive', 'customer', ?)`,
    ).run(Date.now());

    const score = await scoreConversation(env, 'ws_a', 'tkt_score');
    const summary = await getInsightSummary(env, 'ws_a', 30);

    expect(score?.overall_score).toBeGreaterThan(0.8);
    expect(score?.groundedness_score).toBeGreaterThan(0.85);
    expect(summary.resolution_rate).toBe(1);
    expect(summary.avg_overall_score).toBeGreaterThan(0.8);
  });

  it('generates reviewable KB suggestions and accepts them into knowledge', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, {
      id: 'tkt_unanswered_1',
      status: 'open',
      subject: 'Subscription invoice credit question',
      category: 'billing',
    });
    seedTicket(db, {
      id: 'tkt_unanswered_2',
      status: 'pending',
      subject: 'Need invoice credit for subscription',
      category: 'billing',
    });

    const generated = await generateKbSuggestions(env, 'ws_a');
    const accepted = await acceptKbSuggestion(env, 'ws_a', generated.suggestions[0].id, 'usr_a');
    const acceptedAgain = await acceptKbSuggestion(
      env,
      'ws_a',
      generated.suggestions[0].id,
      'usr_a',
    );

    expect(generated.generated).toBe(1);
    expect(generated.suggestions[0].evidence_count).toBe(2);
    expect(generated.suggestions[0].confidence_score).toBeGreaterThan(0.7);
    expect(generated.suggestions[0].source_ticket_ids_json).toContain('tkt_unanswered_1');
    expect(accepted?.sourceId).toMatch(/^ksrc_/);
    expect(acceptedAgain?.sourceId).toBe(accepted?.sourceId);
    expect(db.prepare(`SELECT status FROM kb_suggestion`).get()).toEqual({ status: 'accepted' });
    expect(db.prepare(`SELECT accepted_source_id FROM kb_suggestion`).get()).toEqual({
      accepted_source_id: accepted?.sourceId,
    });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM knowledge_source`).get()).toEqual({ n: 1 });
  });

  it('does not generate KB suggestions from thin single-ticket evidence', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, {
      id: 'tkt_one_off',
      status: 'open',
      subject: 'One off custom invoice memo',
      category: 'billing',
    });

    const generated = await generateKbSuggestions(env, 'ws_a');

    expect(generated.generated).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM kb_suggestion`).get()).toEqual({ n: 0 });
  });

  it('keeps accepted KB suggestions terminal for status updates', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, {
      id: 'tkt_terminal_1',
      status: 'open',
      subject: 'Need invoice credit for subscription',
      category: 'billing',
    });
    seedTicket(db, {
      id: 'tkt_terminal_2',
      status: 'open',
      subject: 'Subscription invoice credit request',
      category: 'billing',
    });
    const generated = await generateKbSuggestions(env, 'ws_a');
    await acceptKbSuggestion(env, 'ws_a', generated.suggestions[0].id, 'usr_a');

    await expect(
      updateKbSuggestionStatus(env, 'ws_a', generated.suggestions[0].id, 'dismissed', 'usr_a'),
    ).rejects.toThrow('kb_suggestion_accepted');
  });

  it('detects knowledge drift from successful replies', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    db.prepare(
      `INSERT INTO knowledge_source (id, workspace_id, kind, title, status, chunk_count, created_at, updated_at)
       VALUES ('ksrc_policy', 'ws_a', 'manual', 'Refund policy', 'ready', 1, 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO knowledge_chunk (
        id, workspace_id, source_id, ordinal, title, body, snippet, vector_id, content_hash,
        used_in_answers_count, created_at, updated_at
      ) VALUES (
        'kchk_policy', 'ws_a', 'ksrc_policy', 0, 'Refund policy',
        'Refund policy covers returned items and order cancellation.',
        'Refund policy covers returned items.', 'vec_policy', 'hash_policy', 2, 1, 1
      )`,
    ).run();
    for (const id of ['tkt_drift_1', 'tkt_drift_2']) {
      seedTicket(db, { id, status: 'resolved', subject: 'Billing help' });
      seedMessage(db, {
        id: `msg_${id}`,
        ticketId: id,
        direction: 'outbound',
        preview: 'We applied a subscription invoice credit and adjusted the renewal invoice.',
      });
      db.prepare(
        `INSERT INTO approval_request (
          id, workspace_id, ticket_id, kind, status, proposed_json, risk_reasons_json, created_at
        ) VALUES (?, 'ws_a', ?, 'draft_reply', 'approved', ?, '[]', ?)`,
      ).run(`apr_${id}`, id, JSON.stringify({ cites_knowledge_ids: ['kchk_policy'] }), Date.now());
    }
    for (const id of ['tkt_unrelated_1', 'tkt_unrelated_2']) {
      seedTicket(db, { id, status: 'resolved', subject: 'Shipping help' });
      seedMessage(db, {
        id: `msg_${id}`,
        ticketId: id,
        direction: 'outbound',
        preview: 'Warehouse dispatch tracking labels carrier pickup manifest.',
      });
    }

    const result = await detectKnowledgeDrift(env, 'ws_a');

    expect(result.detected).toBe(1);
    expect(result.signals[0].severity).toBe('medium');
    expect(result.signals[0].divergence_terms_json).toContain('subscription');
    expect(result.signals[0].divergence_terms_json).not.toContain('warehouse');
  });

  it('protects insight APIs behind workspace admin roles', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_viewer', 'viewer@example.com');
    addMember(db, 'ws_a', 'usr_viewer', 'viewer');
    const cookie = await login(env, 'viewer@example.com');

    const res = await apiApp.request('/insights/summary', { headers: { cookie } }, env);

    expect(res.status).toBe(403);
  });

  it('prunes stale conversation scores without touching recent rows', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    seedTicket(db, { id: 'tkt_old', status: 'resolved' });
    seedTicket(db, { id: 'tkt_recent', status: 'resolved' });
    const now = Date.now();
    db.prepare(
      `INSERT INTO conversation_score (
        id, workspace_id, ticket_id, groundedness_score, tone_score, resolution_score,
        effort_score, overall_score, signals_json, scored_at, updated_at
      ) VALUES
        ('score_old', 'ws_a', 'tkt_old', 1, 1, 1, 1, 1, '{}', ?, ?),
        ('score_recent', 'ws_a', 'tkt_recent', 1, 1, 1, 1, 1, '{}', ?, ?)`,
    ).run(now - 181 * 24 * 60 * 60 * 1000, now - 181 * 24 * 60 * 60 * 1000, now, now);

    const result = await pruneConversationScores(env, 'ws_a', 180);

    expect(result.pruned).toBe(1);
    expect(db.prepare(`SELECT id FROM conversation_score`).all()).toEqual([{ id: 'score_recent' }]);
  });

  it('keeps workspace insights maintenance isolated across workspace failures', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedWorkspace(db, 'ws_bad', 'Bad');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    const originalPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.includes('SELECT id FROM ticket') && sql.includes('ORDER BY updated_at DESC')) {
        return {
          ...statement,
          bind: (...params: unknown[]) => {
            if (params[0] === 'ws_bad') {
              return {
                all: async () => {
                  throw new Error('workspace_score_failed');
                },
                first: async () => null,
                run: async () => ({ success: false }),
              };
            }
            return statement.bind(...params);
          },
        };
      }
      return statement;
    }) as typeof env.DB.prepare;

    const results = await runAllWorkspaceInsightsMaintenance(env);

    expect(results).toContainEqual(
      expect.objectContaining({ workspaceId: 'ws_a', ok: true, pruned: 0 }),
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        workspaceId: 'ws_bad',
        ok: false,
        error: 'workspace_score_failed',
      }),
    );
  });
});

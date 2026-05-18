import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/api/routes';
import { anonymizeValue, detectResidualPii } from '../src/evals/anonymize';
import { captureResolvedTicketEvalCase } from '../src/evals/capture';
import { runEvalSuite, runProcedureSpecEvals } from '../src/evals/replay';
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

function seedResolvedConversation(db: ReturnType<typeof createWorkspaceTestDb>['db']) {
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO ticket (
       id, workspace_id, mailbox_id, subject, status, priority, category, last_message_at,
       requester_email, requester_name, thread_token, created_at, updated_at
     ) VALUES (
       'tkt_eval', 'ws_a', 'mb_a', 'Refund for order 123', 'resolved', 'normal', 'billing', 20,
       'jane.customer@example.com', 'Jane Customer', 'tok_eval', 1, 20
     )`,
  ).run();
  db.prepare(
    `INSERT INTO message_index (
       id, ticket_id, workspace_id, direction, from_address, to_address, subject,
       preview, sent_at, created_at
     ) VALUES (?, 'tkt_eval', 'ws_a', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'msg_in',
    'inbound',
    'jane.customer@example.com',
    'support@example.com',
    'Refund for order 123',
    'Hi, I am Jane Customer. Please refund order 123. My phone is +1 415 555 1212.',
    10,
    10,
  );
  db.prepare(
    `INSERT INTO message_index (
       id, ticket_id, workspace_id, direction, from_address, to_address, subject,
       preview, sent_at, created_at
     ) VALUES (?, 'tkt_eval', 'ws_a', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'msg_out',
    'outbound',
    'support@example.com',
    'jane.customer@example.com',
    'Re: Refund for order 123',
    'Hi Jane Customer, your refund for order 123 has been approved and should arrive within five business days.',
    20,
    20,
  );
  db.prepare(
    `INSERT INTO ticket_outcome_event (
       id, workspace_id, ticket_id, kind, source, payload_json, created_at
     ) VALUES ('out_eval', 'ws_a', 'tkt_eval', 'resolved_autonomously', 'agent', '{}', 20)`,
  ).run();
}

describe('eval anonymization', () => {
  it('redacts stable customer identifiers without storing originals', () => {
    const result = anonymizeValue(
      {
        text: 'Jane Customer wrote from jane.customer@example.com and +1 415 555 1212.',
      },
      {
        requesterEmail: 'jane.customer@example.com',
        requesterName: 'Jane Customer',
      },
    );

    expect(JSON.stringify(result.value)).not.toContain('jane.customer@example.com');
    expect(JSON.stringify(result.value)).not.toContain('Jane Customer');
    expect(JSON.stringify(result.value)).toContain('customer_1@example.test');
    expect(JSON.stringify(result.value)).toContain('[phone_1]');
    expect(JSON.stringify(result.metadata)).not.toContain('jane.customer@example.com');
  });

  it('detects residual PII after anonymization and ignores placeholders', () => {
    const findings = detectResidualPii({
      safe: 'customer_1@example.test [phone_1]',
      timestamp: 1760000000000,
      leaked: 'finance@merchant.example and +1 212 555 0199',
    });

    expect(findings.map((finding) => finding.kind)).toEqual(['email', 'phone']);
  });
});

describe('historical eval capture and replay', () => {
  it('captures resolved tickets as anonymized replay cases', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedResolvedConversation(db);

    const result = await captureResolvedTicketEvalCase(env, 'ws_a', 'tkt_eval');
    expect(result.caseId).toBeTruthy();
    const row = db.prepare(`SELECT * FROM eval_case WHERE id = ?`).get(result.caseId!) as any;

    expect(result.captured).toBe(true);
    expect(row.source).toBe('resolved_ticket');
    expect(row.input_json).not.toContain('jane.customer@example.com');
    expect(row.input_json).not.toContain('Jane Customer');
    expect(row.input_json).toContain('customer_1@example.test');
    expect(row.expected_json).toContain('refund');
  });

  it('captures autonomous resolved outcomes even before ticket closure', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedResolvedConversation(db);
    db.prepare(`UPDATE ticket SET status = 'pending' WHERE id = 'tkt_eval'`).run();

    const result = await captureResolvedTicketEvalCase(env, 'ws_a', 'tkt_eval');

    expect(result.captured).toBe(true);
  });

  it('runs historical evals and marks regressions', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedResolvedConversation(db);
    await captureResolvedTicketEvalCase(env, 'ws_a', 'tkt_eval');

    const passing = await runEvalSuite(env, 'ws_a', {
      retrievalRunner: async () => ({
        hits: [],
        trace: {
          plan: { originalQuery: 'refund', scope: 'all', subqueries: ['refund'], maxHops: 1 },
          hops: [],
          finalAnswerable: false,
          stopReason: 'no_hits',
          startedAt: 1,
          durationMs: 1,
        },
      }),
      draftRunner: async () => ({
        subject: 'Re: Refund for order 123',
        body_markdown:
          'Your refund for order 123 has been approved and should arrive within five business days.',
        tone: 'friendly',
        cites_knowledge_ids: [],
        confidence: 0.9,
        needs_human_review_reasons: [],
      }),
    });
    const failing = await runEvalSuite(env, 'ws_a', {
      retrievalRunner: async () => ({
        hits: [],
        trace: {
          plan: { originalQuery: 'refund', scope: 'all', subqueries: ['refund'], maxHops: 1 },
          hops: [],
          finalAnswerable: false,
          stopReason: 'no_hits',
          startedAt: 1,
          durationMs: 1,
        },
      }),
      draftRunner: async () => ({
        subject: 'Re: Refund for order 123',
        body_markdown: 'We cannot help with this.',
        tone: 'friendly',
        cites_knowledge_ids: [],
        confidence: 0.9,
        needs_human_review_reasons: [],
      }),
    });

    expect(passing.run.status).toBe('passed');
    expect(failing.run.status).toBe('failed');
    expect(failing.run.regression_count).toBe(1);
  });

  it('marks score drops from the previous baseline as regressions', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedResolvedConversation(db);
    await captureResolvedTicketEvalCase(env, 'ws_a', 'tkt_eval');
    const retrievalRunner = async () => ({
      hits: [],
      trace: {
        plan: {
          originalQuery: 'refund',
          scope: 'all' as const,
          subqueries: ['refund'],
          maxHops: 1,
        },
        hops: [],
        finalAnswerable: false,
        stopReason: 'no_hits' as const,
        startedAt: 1,
        durationMs: 1,
      },
    });

    await runEvalSuite(env, 'ws_a', {
      threshold: 0.2,
      retrievalRunner,
      draftRunner: async () => ({
        subject: 'Re: Refund for order 123',
        body_markdown:
          'Hi, your refund for order 123 has been approved and should arrive within five business days.',
        tone: 'friendly',
        cites_knowledge_ids: [],
        confidence: 0.9,
        needs_human_review_reasons: [],
      }),
    });
    const regressed = await runEvalSuite(env, 'ws_a', {
      threshold: 0.2,
      scoreDropThreshold: 0.15,
      retrievalRunner,
      draftRunner: async () => ({
        subject: 'Re: Refund for order 123',
        body_markdown: 'Your refund has been approved and should arrive.',
        tone: 'friendly',
        cites_knowledge_ids: [],
        confidence: 0.9,
        needs_human_review_reasons: [],
      }),
    });

    expect(regressed.run.passed_count).toBe(1);
    expect(regressed.run.failed_count).toBe(0);
    expect(regressed.run.regression_count).toBe(1);
    expect(regressed.run.status).toBe('failed');
  });
});

describe('procedure spec evals', () => {
  it('checks inline procedure expectations', () => {
    const report = runProcedureSpecEvals({
      slug: 'refund-intake',
      name: 'Refund intake',
      version: '1.0.0',
      trigger: { type: 'manual' },
      steps: [
        { id: 'priority', type: 'set_ticket_field', field: 'priority', value: 'high' },
        { id: 'wait', type: 'ask_customer', message: 'Please send the order id.' },
      ],
      evals: [
        {
          name: 'waits after priority',
          input: { ticket: { subject: 'Refund' } },
          expect: {
            status: 'waiting',
            context: { 'ticket.priority': 'high' },
            steps: ['priority', 'wait'],
          },
        },
      ],
    });

    expect(report.status).toBe('passed');
    expect(report.passed_count).toBe(1);
  });
});

describe('eval API', () => {
  it('lets workspace owners capture resolved conversation evals', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_a', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_a', 'owner');
    seedResolvedConversation(db);
    const cookie = await login(env, 'owner@example.com');

    const res = await apiApp.request(
      '/evals/cases/capture-resolved',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      },
      env,
    );
    const body = await res.json<any>();

    expect(res.status).toBe(200);
    expect(body.captured).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM eval_case`).get()).toEqual({ n: 1 });

    const archive = await apiApp.request(
      `/evals/cases/${body.cases[0]}`,
      {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      },
      env,
    );

    expect(archive.status).toBe(200);
    expect(db.prepare(`SELECT status FROM eval_case WHERE id = ?`).get(body.cases[0])).toEqual({
      status: 'archived',
    });
  });
});

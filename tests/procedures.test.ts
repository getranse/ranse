import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/server/http/api/routes';
import { createProcedureRun, upsertProcedureVersion } from '../src/server/procedures/storage';
import { runProcedure } from '../src/server/procedures/runner';
import { normalizeProcedureSpec } from '../src/server/procedures/schema';
import { simulateProcedure } from '../src/server/procedures/simulate';
import {
  addMember,
  createWorkspaceTestDb,
  login,
  seedMailbox,
  seedUser,
  seedWorkspace,
} from './helpers/workspace-db';

vi.mock('agents', () => ({
  getAgentByName: () => ({
    start: async () => undefined,
    resume: async () => undefined,
  }),
  Agent: class {},
  callable: () => () => undefined,
}));

function seedTicket(db: ReturnType<typeof createWorkspaceTestDb>['db']) {
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO ticket (
       id, workspace_id, mailbox_id, subject, status, priority, last_message_at,
       requester_email, thread_token, created_at, updated_at
     ) VALUES ('tkt_1', 'ws_a', 'mb_a', 'Refund request', 'open', 'normal', 1, 'customer@example.com', 'tok_1', 1, 1)`,
  ).run();
}

const baseSpec = {
  slug: 'refund-intake',
  name: 'Refund intake',
  version: '1.0.0',
  trigger: { type: 'manual' },
  steps: [
    { id: 'note', type: 'add_note', body: 'Started {{ ticket.subject }}' },
    { id: 'resolve', type: 'set_ticket_field', field: 'status', value: 'resolved' },
  ],
};

describe('procedure schema and simulation', () => {
  it('rejects duplicate step ids across nested steps', () => {
    expect(() =>
      normalizeProcedureSpec({
        ...baseSpec,
        steps: [
          { id: 'same', type: 'add_note', body: 'One' },
          {
            id: 'branch',
            type: 'if',
            condition: { var: 'ticket.id', exists: true },
            then: [{ id: 'same', type: 'add_note', body: 'Two' }],
          },
        ],
      }),
    ).toThrow('Duplicate step id');
  });

  it('dry-runs deterministic steps and stops at customer waits', () => {
    const result = simulateProcedure(
      {
        ...baseSpec,
        steps: [
          { id: 'set_priority', type: 'set_ticket_field', field: 'priority', value: 'high' },
          { id: 'ask', type: 'ask_customer', message: 'Please send order id.' },
          { id: 'note', type: 'add_note', body: 'after wait' },
        ],
      },
      { ticket: { subject: 'Refund' } },
    );

    expect(result.status).toBe('waiting');
    expect(result.context.ticket).toMatchObject({ priority: 'high' });
    expect(result.steps.map((step) => step.step_id)).toEqual(['set_priority', 'ask']);
  });
});

describe('procedure runner', () => {
  it('runs checkpointed deterministic steps and records procedure resolution outcome', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, { workspaceId: 'ws_a', spec: baseSpec });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'refund-intake',
      ticketId: 'tkt_1',
      context: { ticket: { subject: 'Refund request' } },
    });

    const completed = await runProcedure(env, 'ws_a', run.id);

    expect(completed.status).toBe('completed');
    expect(db.prepare(`SELECT status FROM ticket WHERE id = 'tkt_1'`).get()).toEqual({
      status: 'resolved',
    });
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM procedure_step_run WHERE run_id = ?`).get(run.id),
    ).toEqual({ n: 2 });
    expect(
      db.prepare(`SELECT kind FROM ticket_outcome_event WHERE ticket_id = 'tkt_1'`).get(),
    ).toEqual({
      kind: 'resolved_via_procedure',
    });
  });

  it('deduplicates triggered runs by trigger event key', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, { workspaceId: 'ws_a', spec: baseSpec });

    const first = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'refund-intake',
      ticketId: 'tkt_1',
      triggerEventKey: 'ticket_created:tkt_1',
    });
    const second = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'refund-intake',
      ticketId: 'tkt_1',
      triggerEventKey: 'ticket_created:tkt_1',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM procedure_run`).get()).toEqual({ n: 1 });
  });

  it('waits across customer turns without sending duplicate ask-customer replies', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        ...baseSpec,
        slug: 'collect-order',
        steps: [
          { id: 'ask_order', type: 'ask_customer', message: 'What is the order id?' },
          { id: 'note', type: 'add_note', body: 'Customer replied.' },
        ],
      },
    });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'collect-order',
      ticketId: 'tkt_1',
    });
    let sends = 0;
    const sendThreadedReply = async () => {
      sends += 1;
      return { messageId: `msg_${sends}` };
    };

    const waiting = await runProcedure(env, 'ws_a', run.id, { sendThreadedReply });
    const completed = await runProcedure(env, 'ws_a', run.id, {
      sendThreadedReply,
      event: { type: 'customer_reply', payload: { messageId: 'in_2' } },
    });

    expect(waiting.status).toBe('waiting');
    expect(completed.status).toBe('completed');
    expect(sends).toBe(1);
    expect(
      db
        .prepare(`SELECT status FROM procedure_step_run WHERE run_id = ? ORDER BY step_index`)
        .all(run.id),
    ).toEqual([{ status: 'completed' }, { status: 'completed' }]);
  });

  it('replays checkpointed branches instead of recalculating after context changes', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        ...baseSpec,
        slug: 'branch-stability',
        steps: [
          {
            id: 'needs_order',
            type: 'if',
            condition: { var: 'ticket.needs_order', equals: true },
            then: [
              { id: 'ask_order', type: 'ask_customer', message: 'What is the order id?' },
              { id: 'then_note', type: 'add_note', body: 'then branch' },
            ],
            else: [{ id: 'else_note', type: 'add_note', body: 'else branch' }],
          },
        ],
      },
    });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'branch-stability',
      ticketId: 'tkt_1',
      context: { ticket: { needs_order: true } },
    });
    const sendThreadedReply = async () => ({ messageId: 'msg_1' });

    await runProcedure(env, 'ws_a', run.id, { sendThreadedReply });
    db.prepare(`UPDATE procedure_run SET context_json = ? WHERE id = ?`).run(
      JSON.stringify({ ticket_id: 'tkt_1', procedure_slug: 'branch-stability', ticket: { needs_order: false } }),
      run.id,
    );
    await runProcedure(env, 'ws_a', run.id, {
      sendThreadedReply,
      event: { type: 'customer_reply', payload: { messageId: 'in_2' } },
    });

    expect(db.prepare(`SELECT preview FROM message_index WHERE direction = 'note'`).all()).toEqual([
      { preview: 'then branch' },
    ]);
  });

  it('replays checkpointed loop items after context changes between waits', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        ...baseSpec,
        slug: 'loop-stability',
        steps: [
          {
            id: 'orders',
            type: 'loop',
            each: 'orders',
            as: 'order',
            steps: [{ id: 'ask_order', type: 'ask_customer', message: 'Approve {{ order }}?' }],
          },
        ],
      },
    });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'loop-stability',
      ticketId: 'tkt_1',
      context: { orders: ['A', 'B'] },
    });
    const asks: string[] = [];
    const sendThreadedReply = async ({ body }: { body: string }) => {
      asks.push(body);
      return { messageId: `msg_${asks.length}` };
    };

    await runProcedure(env, 'ws_a', run.id, { sendThreadedReply: sendThreadedReply as any });
    db.prepare(`UPDATE procedure_run SET context_json = ? WHERE id = ?`).run(
      JSON.stringify({ ticket_id: 'tkt_1', procedure_slug: 'loop-stability', orders: ['C'] }),
      run.id,
    );
    const waitingAgain = await runProcedure(env, 'ws_a', run.id, {
      sendThreadedReply: sendThreadedReply as any,
      event: { type: 'customer_reply', payload: { messageId: 'in_2' } },
    });

    expect(waitingAgain.status).toBe('waiting');
    expect(asks).toEqual(['Approve A?', 'Approve B?']);
  });

  it('fails cleanly before writing invalid rendered ticket fields', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        ...baseSpec,
        slug: 'invalid-status',
        steps: [
          { id: 'bad_status', type: 'set_ticket_field', field: 'status', value: '{{ next_status }}' },
        ],
      },
    });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'invalid-status',
      ticketId: 'tkt_1',
      context: { next_status: 'refunded' },
    });

    const failed = await runProcedure(env, 'ws_a', run.id);

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('invalid_ticket_status');
    expect(db.prepare(`SELECT status FROM ticket WHERE id = 'tkt_1'`).get()).toEqual({
      status: 'open',
    });
    expect(
      db.prepare(`SELECT status, error FROM procedure_step_run WHERE run_id = ?`).get(run.id),
    ).toEqual({ status: 'failed', error: 'invalid_ticket_status' });
  });

  it('fails a waiting run on the matching timeout event', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        ...baseSpec,
        slug: 'wait-timeout',
        steps: [
          { id: 'wait', type: 'wait_for_event', event: 'customer_reply', timeout_ms: 1000 },
          { id: 'note', type: 'add_note', body: 'after wait' },
        ],
      },
    });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'wait-timeout',
      ticketId: 'tkt_1',
    });

    const waiting = await runProcedure(env, 'ws_a', run.id);
    const failed = await runProcedure(env, 'ws_a', run.id, {
      event: { type: 'timeout', payload: { stepIndex: 0 } },
    });

    expect(waiting.status).toBe('waiting');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('procedure_wait_timeout');
  });

  it('lets an operator manually resume a waiting step', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        ...baseSpec,
        slug: 'manual-resume',
        steps: [
          { id: 'wait', type: 'wait_for_event', event: 'approval_decided' },
          { id: 'note', type: 'add_note', body: 'manually resumed' },
        ],
      },
    });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'manual-resume',
      ticketId: 'tkt_1',
    });

    await runProcedure(env, 'ws_a', run.id);
    const completed = await runProcedure(env, 'ws_a', run.id, {
      event: { type: 'manual_resume', payload: { reason: 'operator override' } },
    });

    expect(completed.status).toBe('completed');
    expect(db.prepare(`SELECT preview FROM message_index WHERE direction = 'note'`).get()).toEqual({
      preview: 'manually resumed',
    });
  });
});

describe('procedure API', () => {
  it('publishes procedures through owner/admin routes and hides them from other workspaces', async () => {
    const { db, env } = createWorkspaceTestDb();
    await seedUser(db, 'owner', 'owner@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedWorkspace(db, 'ws_b', 'Beta');
    addMember(db, 'ws_a', 'owner', 'owner');

    const cookie = await login(env, 'owner@example.com');
    const published = await apiApp.request(
      '/procedures',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ spec: baseSpec }),
      },
      env,
    );
    expect(published.status).toBe(200);

    const listed: any = await (
      await apiApp.request('/procedures', { headers: { cookie } }, env)
    ).json();
    expect(listed.procedures.map((procedure: any) => procedure.slug)).toEqual(['refund-intake']);
  });
});

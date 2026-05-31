import { describe, expect, it, vi } from 'vitest';
import { dismissOnboarding, getOnboardingState } from '../src/server/platform/onboarding/state';
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
  return { db, env };
}

describe('onboarding state', () => {
  it('reports zero steps done on a fresh workspace and shows the banner', async () => {
    const { env } = await setup();
    const state = await getOnboardingState(env as never, 'ws_a');
    expect(state.steps).toHaveLength(3);
    expect(state.completedCount).toBe(0);
    expect(state.shouldShow).toBe(true);
  });

  it('marks ingest_knowledge done when a knowledge_source row exists', async () => {
    const { db, env } = await setup();
    db.prepare(
      `INSERT INTO knowledge_source (id, workspace_id, kind, title, status, chunk_count, updated_at)
       VALUES ('ks_1', 'ws_a', 'manual', 'Help center', 'ready', 0, 1)`,
    ).run();
    const state = await getOnboardingState(env as never, 'ws_a');
    expect(state.steps.find((s) => s.id === 'ingest_knowledge')?.done).toBe(true);
    expect(state.completedCount).toBe(1);
  });

  it('marks connect_channel done as soon as a mailbox exists', async () => {
    const { db, env } = await setup();
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    const state = await getOnboardingState(env as never, 'ws_a');
    expect(state.steps.find((s) => s.id === 'connect_channel')?.done).toBe(true);
  });

  it('marks first_reply done when an outbound message_index row exists', async () => {
    const { db, env } = await setup();
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, status, priority, requester_email, last_message_at, thread_token, created_at, updated_at)
       VALUES ('tkt_a', 'ws_a', 'mb_a', 'Hi', 'open', 'normal', 'cx@example.com', 1, 'thr', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, from_address, to_address, subject, preview, has_attachments, sent_at, created_at)
       VALUES ('msg_1', 'tkt_a', 'ws_a', 'outbound', 'support@example.com', 'cx@example.com', 'Re: Hi', 'ok', 0, 1, 1)`,
    ).run();
    const state = await getOnboardingState(env as never, 'ws_a');
    expect(state.steps.find((s) => s.id === 'first_reply')?.done).toBe(true);
  });

  it('hides the banner once dismissed even when steps remain', async () => {
    const { env } = await setup();
    await dismissOnboarding(env as never, 'ws_a');
    const state = await getOnboardingState(env as never, 'ws_a');
    expect(state.dismissed).toBe(true);
    expect(state.shouldShow).toBe(false);
  });

  it('hides the banner once every step is done, even without dismissal', async () => {
    const { db, env } = await setup();
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    db.prepare(
      `INSERT INTO knowledge_source (id, workspace_id, kind, title, status, chunk_count, updated_at)
       VALUES ('ks_1', 'ws_a', 'manual', 'Help center', 'ready', 0, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, status, priority, requester_email, last_message_at, thread_token, created_at, updated_at)
       VALUES ('tkt_a', 'ws_a', 'mb_a', 'Hi', 'open', 'normal', 'cx@example.com', 1, 'thr', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, from_address, to_address, subject, preview, has_attachments, sent_at, created_at)
       VALUES ('msg_1', 'tkt_a', 'ws_a', 'outbound', 'support@example.com', 'cx@example.com', 'Re: Hi', 'ok', 0, 1, 1)`,
    ).run();
    const state = await getOnboardingState(env as never, 'ws_a');
    expect(state.completedCount).toBe(3);
    expect(state.shouldShow).toBe(false);
  });
});

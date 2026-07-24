import { describe, expect, it } from 'vitest';
import { hmacSign } from '../src/lib/crypto';
import {
  createWebhookSubscription,
  enqueueWebhookDeliveries,
  listWebhookSubscriptions,
} from '../src/server/actions/webhooks';
import type { NotificationEvent } from '../src/server/inbox/notifications/events';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  db.exec(`CREATE TABLE webhook_subscription (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL,
    events_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL)`);
  const sent: any[] = [];
  (env as any).WEBHOOKS = { send: async (m: any) => void sent.push(m) };
  return { db, env, sent };
}

function event(name: string): NotificationEvent {
  return {
    name,
    payload: { ticketId: 't_1', subject: 'Hi' },
    workspaceId: 'ws_a',
    emittedAt: 123,
  } as unknown as NotificationEvent;
}

describe('webhook subscriptions', () => {
  it('enqueues signed deliveries only for matching active subscriptions', async () => {
    const { db, env, sent } = setup();
    const { subscription, secret } = await createWebhookSubscription(env, {
      workspaceId: 'ws_a',
      url: 'https://hooks.example.com/ranse',
      events: ['ticket.created'],
    });
    await createWebhookSubscription(env, {
      workspaceId: 'ws_a',
      url: 'https://hooks.example.com/other',
      events: ['message.inbound'],
    });
    db.prepare(`UPDATE webhook_subscription SET active = 0 WHERE url LIKE '%other%'`).run();

    await enqueueWebhookDeliveries(env, event('ticket.created'));
    await enqueueWebhookDeliveries(env, event('message.inbound'));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'webhook.deliver',
      url: 'https://hooks.example.com/ranse',
    });
    // The signature verifies against the returned secret.
    const expected = await hmacSign(secret, JSON.stringify(event('ticket.created')));
    expect(sent[0].signature).toBe(expected);
    void subscription;
  });

  it('returns the signing secret once and never lists it', async () => {
    const { env } = setup();
    const { secret } = await createWebhookSubscription(env, {
      workspaceId: 'ws_a',
      url: 'https://hooks.example.com/x',
      events: ['ticket.created'],
    });
    expect(secret).toMatch(/^whsec_/);
    const listed = await listWebhookSubscriptions(env, 'ws_a');
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(listed[0].events).toEqual(['ticket.created']);
  });

  it('never crosses workspaces', async () => {
    const { db, env, sent } = setup();
    seedWorkspace(db, 'ws_b', 'Beta');
    await createWebhookSubscription(env, {
      workspaceId: 'ws_b',
      url: 'https://hooks.example.com/b',
      events: ['ticket.created'],
    });
    await enqueueWebhookDeliveries(env, event('ticket.created')); // ws_a event
    expect(sent).toHaveLength(0);
  });
});

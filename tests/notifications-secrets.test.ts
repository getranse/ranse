import { describe, expect, it, vi } from 'vitest';
// Importing channels/index triggers built-in adapter registration. The
// dispatcher resolves adapters from that registry, so this import is
// required even though we don't use its exports directly.
import '../src/server/channels';
import { dispatchOutbound, retryBackoffMs } from '../src/server/channels/egress';
import { isSealedString, openJson, partitionSecrets, sealJson } from '../src/server/lib/secrets';
import { notifyCustomer } from '../src/server/notifications/cascade';
import { upsertTemplate } from '../src/server/notifications/cascade/templates';
import { canDeliverTo, setPreference } from '../src/server/notifications/preferences';
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
     VALUES ('cust_a', 'ws_a', 'Ada', 'ada@example.com', '+15551234567', 1, 1)`,
  ).run();
  return { db, env };
}

describe('secret encryption at rest', () => {
  it('round-trips an object through seal/open', async () => {
    const { env } = await setup();
    const sealed = await sealJson(env as never, 'ws_a', {
      bot_token: 'xoxb-abc',
      signing_secret: 'shhh',
    });
    expect(sealed).not.toBeNull();
    expect(isSealedString(sealed!)).toBe(true);
    const opened = await openJson<{ bot_token: string; signing_secret: string }>(
      env as never,
      'ws_a',
      sealed,
    );
    expect(opened.bot_token).toBe('xoxb-abc');
    expect(opened.signing_secret).toBe('shhh');
  });

  it('returns plaintext untouched when the value is not sealed', async () => {
    const { env } = await setup();
    const opened = await openJson(env as never, 'ws_a', '{"foo":"bar"}');
    expect(opened).toEqual({ foo: 'bar' });
  });

  it('fails to decrypt with a different workspace id', async () => {
    const { env } = await setup();
    const sealed = await sealJson(env as never, 'ws_a', { secret: 'top' });
    await expect(openJson(env as never, 'ws_other', sealed)).rejects.toThrow();
  });

  it('partitionSecrets separates declared secret fields', () => {
    const { publicConfig, secrets } = partitionSecrets(
      { signing_secret: 'shhh', team_id: 'T1', bot_token: 'xoxb' },
      ['signing_secret', 'bot_token'],
    );
    expect(publicConfig).toEqual({ team_id: 'T1' });
    expect(secrets).toEqual({ signing_secret: 'shhh', bot_token: 'xoxb' });
  });
});

describe('channel preferences', () => {
  it('blocks delivery when the customer has opted out', async () => {
    const { env } = await setup();
    await setPreference(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      channelKind: 'sms',
      status: 'disabled',
      consentSource: 'unit-test',
    });
    const result = await canDeliverTo(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      channelKind: 'sms',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('opted_out');
  });

  it('allows delivery when no preference row exists', async () => {
    const { env } = await setup();
    const result = await canDeliverTo(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      channelKind: 'sms',
    });
    expect(result.allowed).toBe(true);
  });

  it('outbound dispatcher records preference_opted_out as the failure reason', async () => {
    const { db, env } = await setup();
    await setPreference(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      channelKind: 'sms',
      status: 'disabled',
      consentSource: 'inbound_keyword:stop',
    });
    db.prepare(
      `INSERT INTO public_channel (id, workspace_id, mailbox_id, kind, name, public_key, enabled, require_email, allowed_origins_json, welcome_message, config_json, secrets_ciphertext, secret_ciphertext, signing_secret, sla_first_response_minutes, sla_resolution_minutes, default_priority, default_assignee_user_id, last_event_at, created_at, updated_at)
       VALUES ('pubch_sms', 'ws_a', 'mb_a', 'sms', 'SMS', 'pub_sms', 1, 0, '[]', NULL, '{}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, status, priority, requester_email, last_message_at, thread_token, customer_id, origin_channel_kind, origin_channel_id, created_at, updated_at)
       VALUES ('tkt_a', 'ws_a', 'mb_a', 'SMS', 'open', 'normal', '+15551234567', 1, 'thread_a', 'cust_a', 'sms', 'pubch_sms', 1, 1)`,
    ).run();
    const outcome = await dispatchOutbound(env as never, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_a',
      messageId: 'msg_dispatch',
      text: 'hello',
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('preference_opted_out');
    const dispatchRow = db
      .prepare(`SELECT status, last_error, next_attempt_at FROM channel_outbound_dispatch`)
      .get() as { status: string; last_error: string; next_attempt_at: number | null };
    // Preference-blocked dispatches must not auto-retry.
    expect(dispatchRow.status).toBe('failed');
    expect(dispatchRow.next_attempt_at).toBeNull();
  });
});

describe('cascade engine', () => {
  it('materializes a multi-step plan from a template', async () => {
    const { db, env } = await setup();
    db.prepare(
      `INSERT INTO public_channel (id, workspace_id, mailbox_id, kind, name, public_key, enabled, require_email, allowed_origins_json, welcome_message, config_json, secrets_ciphertext, secret_ciphertext, signing_secret, sla_first_response_minutes, sla_resolution_minutes, default_priority, default_assignee_user_id, last_event_at, created_at, updated_at)
       VALUES ('pubch_sms', 'ws_a', 'mb_a', 'sms', 'SMS', 'pub_sms', 1, 0, '[]', NULL, '{}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)`,
    ).run();
    await upsertTemplate(env as never, {
      workspaceId: 'ws_a',
      slug: 'shipping-update',
      name: 'Shipping update',
      defaultChannels: [
        { channelKind: 'sms', triggerOn: 'immediate' },
        { channelKind: 'email', triggerOn: 'previous_no_ack', delayMs: 60 * 60_000 },
      ],
      bodies: {
        sms: { text: 'Your order {{ payload.order }} shipped.' },
        email: { text: 'Hello {{ payload.name }}, your order {{ payload.order }} shipped.' },
      },
    });
    const { planId, stepCount } = await notifyCustomer(env as never, {
      workspaceId: 'ws_a',
      customerId: 'cust_a',
      templateSlug: 'shipping-update',
      payload: { order: '#1001', name: 'Ada' },
      urgency: 'normal',
    });
    expect(stepCount).toBe(2);
    const steps = db
      .prepare(
        `SELECT sequence, channel_kind, body_text, trigger_on FROM notification_step ORDER BY sequence`,
      )
      .all() as { sequence: number; channel_kind: string; body_text: string; trigger_on: string }[];
    expect(steps).toHaveLength(2);
    expect(steps[0].channel_kind).toBe('sms');
    expect(steps[0].body_text).toBe('Your order #1001 shipped.');
    expect(steps[1].channel_kind).toBe('email');
    expect(steps[1].body_text).toContain('Ada');
    expect(steps[1].trigger_on).toBe('previous_no_ack');
    expect(planId).toMatch(/^nplan_/);
  });
});

describe('dispatch retry backoff', () => {
  it('grows roughly exponentially across attempts', () => {
    const a = retryBackoffMs(1);
    const b = retryBackoffMs(2);
    const c = retryBackoffMs(3);
    const d = retryBackoffMs(5);
    // Each subsequent attempt is at least 3x the previous (with jitter).
    expect(b).toBeGreaterThan(a * 2);
    expect(c).toBeGreaterThan(b * 2);
    expect(d).toBeGreaterThan(c);
  });
});

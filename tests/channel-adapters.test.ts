import { describe, expect, it, vi } from 'vitest';
import {
  ingestInboundMessage,
  listAdapters,
  resolveCustomerIdentity,
  tryGetAdapter,
} from '../src/server/channels';
import { slackAdapter } from '../src/server/channels/adapters/slack';
import { smsAdapter } from '../src/server/channels/adapters/sms';
import { telegramAdapter } from '../src/server/channels/adapters/telegram';
import { whatsappAdapter } from '../src/server/channels/adapters/whatsapp';
import { hmacSign } from '../src/server/lib/crypto';
import type { PublicChannel } from '../src/types/channels';
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

function fakeChannel(overrides: Partial<PublicChannel> = {}): PublicChannel {
  return {
    id: 'pubch_x',
    workspace_id: 'ws_a',
    mailbox_id: 'mb_a',
    mailbox_address: 'support@example.com',
    kind: 'slack',
    name: 'Slack',
    public_key: 'pub_test',
    enabled: 1,
    require_email: 0,
    allowed_origins_json: '[]',
    welcome_message: null,
    config_json: '{}',
    secrets_ciphertext: null,
    secret_ciphertext: null,
    signing_secret: null,
    sla_first_response_minutes: null,
    sla_resolution_minutes: null,
    default_priority: null,
    default_assignee_user_id: null,
    last_event_at: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

async function seedSetup() {
  const { db, env } = createWorkspaceTestDb();
  await seedUser(db, 'owner', 'owner@example.com');
  seedWorkspace(db, 'ws_a', 'Alpha');
  addMember(db, 'ws_a', 'owner', 'owner');
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  return { db, env };
}

describe('channel registry', () => {
  it('registers every built-in adapter exactly once', () => {
    const kinds = listAdapters()
      .map((a) => a.kind)
      .sort();
    expect(kinds).toEqual([
      'apple_business',
      'chat',
      'discord',
      'email',
      'form',
      'instagram',
      'messenger',
      'rcs',
      'slack',
      'sms',
      'teams',
      'telegram',
      'voice',
      'webhook',
      'whatsapp',
    ]);
  });

  it('exposes capabilities every adapter promises to honor', () => {
    for (const adapter of listAdapters()) {
      const caps = adapter.capabilities;
      expect(typeof caps.supportsInbound).toBe('boolean');
      expect(typeof caps.supportsOutbound).toBe('boolean');
      expect(caps.maxMessageLength).toBeGreaterThan(0);
    }
  });

  it('rejects unknown channel kinds when fetching the adapter', () => {
    expect(tryGetAdapter('email')).toBeDefined();
    expect(tryGetAdapter('bogus' as never)).toBeUndefined();
  });
});

describe('slack adapter signature verification', () => {
  const signingSecret = 'test_signing_secret_must_be_long_enough';

  async function signSlack(body: string, timestamp: string) {
    return `v0=${await hmacSign(signingSecret, `v0:${timestamp}:${body}`)}`;
  }

  it('accepts a correctly signed Slack event', async () => {
    const channel = fakeChannel({
      kind: 'slack',
      config_json: JSON.stringify({ bot_token: 'xoxb-...', signing_secret: signingSecret }),
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: 'event_callback' });
    const sig = await signSlack(body, ts);
    const verified = await slackAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig },
      body,
    );
    expect(verified.ok).toBe(true);
  });

  it('rejects a stale timestamp even if the signature is otherwise valid', async () => {
    const channel = fakeChannel({
      kind: 'slack',
      config_json: JSON.stringify({ bot_token: 'xoxb-...', signing_secret: signingSecret }),
    });
    const ts = String(Math.floor(Date.now() / 1000) - 60 * 60); // an hour ago
    const body = JSON.stringify({ type: 'event_callback' });
    const sig = await signSlack(body, ts);
    const verified = await slackAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig },
      body,
    );
    expect(verified.ok).toBe(false);
  });

  it('rejects when signing secret does not match', async () => {
    const channel = fakeChannel({
      kind: 'slack',
      config_json: JSON.stringify({ bot_token: 'xoxb-...', signing_secret: signingSecret }),
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: 'event_callback' });
    const sig = `v0=${await hmacSign('different_secret', `v0:${ts}:${body}`)}`;
    const verified = await slackAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig },
      body,
    );
    expect(verified.ok).toBe(false);
  });

  it('returns a url_verification PONG when challenge is sent', async () => {
    const channel = fakeChannel({ kind: 'slack', config_json: '{}' });
    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'url_verification', challenge: 'abc123' }),
    });
    const response = await slackAdapter.handleChallenge!({} as never, channel, request);
    expect(response).not.toBeNull();
    expect(await response!.text()).toBe('abc123');
  });
});

describe('telegram adapter ingress', () => {
  it('parses a text message into an inbound payload with chat thread', async () => {
    const channel = fakeChannel({
      kind: 'telegram',
      config_json: JSON.stringify({
        bot_token: '12345:ABCDEFGHIJKLMNOPQRSTUVWX',
        webhook_url: 'https://example.com/wh',
        secret_token: 'tg_secret_token_long_enough',
      }),
    });
    const update = JSON.stringify({
      message: {
        message_id: 17,
        date: 1700000000,
        chat: { id: 555, type: 'private' },
        from: { id: 100, first_name: 'Ada', username: 'ada' },
        text: 'My order never arrived',
      },
    });
    const parsed = await telegramAdapter.parseIngress({} as never, channel, {}, update);
    expect(parsed).not.toBeNull();
    expect(parsed!.externalThreadId).toBe('555');
    expect(parsed!.from.externalId).toBe('100');
    expect(parsed!.from.displayName).toBe('Ada');
    expect(parsed!.text).toBe('My order never arrived');
  });

  it('rejects ingress when secret token header is missing', async () => {
    const channel = fakeChannel({
      kind: 'telegram',
      config_json: JSON.stringify({
        bot_token: '12345:ABCDEFGHIJKLMNOPQRSTUVWX',
        webhook_url: 'https://example.com/wh',
        secret_token: 'tg_secret_token_long_enough',
      }),
    });
    const result = await telegramAdapter.verifyWebhook({} as never, channel, {}, '');
    expect(result.ok).toBe(false);
  });
});

describe('whatsapp adapter ingress', () => {
  it('ignores events for sibling phone numbers on the same Meta app', async () => {
    const channel = fakeChannel({
      kind: 'whatsapp',
      config_json: JSON.stringify({
        phone_number_id: '111',
        app_secret: 'app_secret_long_enough',
        access_token: 'access_token_long_enough',
        verify_token: 'verify_token_long',
      }),
    });
    const payload = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '222' }, // different number
                messages: [{ id: 'm1', from: '15550000001', text: { body: 'hello' } }],
              },
            },
          ],
        },
      ],
    });
    const parsed = await whatsappAdapter.parseIngress({} as never, channel, {}, payload);
    expect(parsed).toBeNull();
  });

  it('parses a text message addressed to the configured phone number', async () => {
    const channel = fakeChannel({
      kind: 'whatsapp',
      config_json: JSON.stringify({
        phone_number_id: '111',
        app_secret: 'app_secret_long_enough',
        access_token: 'access_token_long_enough',
        verify_token: 'verify_token_long',
      }),
    });
    const payload = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '111' },
                contacts: [{ profile: { name: 'Grace' } }],
                messages: [{ id: 'm2', from: '15550000002', text: { body: 'need help' } }],
              },
            },
          ],
        },
      ],
    });
    const parsed = await whatsappAdapter.parseIngress({} as never, channel, {}, payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.from.phone).toBe('15550000002');
    expect(parsed!.from.displayName).toBe('Grace');
    expect(parsed!.text).toBe('need help');
  });
});

describe('sms adapter signature verification', () => {
  it('verifies a Twilio signature over the webhook URL plus sorted params', async () => {
    const channel = fakeChannel({
      kind: 'sms',
      config_json: JSON.stringify({
        provider: 'twilio',
        account_sid: 'ACxxxx',
        auth_token: 'a_long_enough_auth_token_value',
        from_number: '+15551234567',
        webhook_url: 'https://support.example.com/public/channels/pub_test/webhook',
      }),
    });
    const rawBody = 'Body=hello&From=%2B15550001111&MessageSid=SM1&To=%2B15551234567';
    const signature = await computeTwilioSignature(
      'a_long_enough_auth_token_value',
      'https://support.example.com/public/channels/pub_test/webhook',
      parseFormPairs(rawBody),
    );
    const verified = await smsAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-twilio-signature': signature },
      rawBody,
    );
    expect(verified.ok).toBe(true);
  });
});

describe('identity stitching', () => {
  it('reuses the same customer when an email matches across two channels', async () => {
    const { env } = await seedSetup();
    const first = await resolveCustomerIdentity(env as never, {
      workspaceId: 'ws_a',
      channelKind: 'sms',
      externalId: '+15550001111',
      phone: '+15550001111',
      email: 'ada@example.com',
    });
    const second = await resolveCustomerIdentity(env as never, {
      workspaceId: 'ws_a',
      channelKind: 'slack',
      externalId: 'T1:U1',
      email: 'ada@example.com',
    });
    expect(second.customerId).toBe(first.customerId);
  });

  it('creates separate customers when there is no shared contact', async () => {
    const { env } = await seedSetup();
    const a = await resolveCustomerIdentity(env as never, {
      workspaceId: 'ws_a',
      channelKind: 'sms',
      externalId: '+15550000001',
      phone: '+15550000001',
    });
    const b = await resolveCustomerIdentity(env as never, {
      workspaceId: 'ws_a',
      channelKind: 'sms',
      externalId: '+15550000002',
      phone: '+15550000002',
    });
    expect(a.customerId).not.toBe(b.customerId);
  });
});

describe('ingress pipeline', () => {
  it('opens a new ticket the first time a customer messages on a channel', async () => {
    const { db, env } = await seedSetup();
    db.prepare(
      `INSERT INTO public_channel (id, workspace_id, mailbox_id, kind, name, public_key, enabled, require_email, allowed_origins_json, welcome_message, config_json, secret_ciphertext, signing_secret, sla_first_response_minutes, sla_resolution_minutes, default_priority, default_assignee_user_id, last_event_at, created_at, updated_at)
       VALUES ('pubch_slack', 'ws_a', 'mb_a', 'slack', 'Slack', 'pub_slack', 1, 0, '[]', NULL, '{}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)`,
    ).run();
    const channel = fakeChannel({
      id: 'pubch_slack',
      kind: 'slack',
      public_key: 'pub_slack',
      mailbox_address: 'support@example.com',
    });
    const result = await ingestInboundMessage(env as never, channel, {
      externalId: 'slack:msg:1',
      externalThreadId: 'C1:1700000000.000100',
      text: 'hello team',
      from: { externalId: 'T1:U2', displayName: 'Grace' },
      receivedAt: Date.now(),
    });
    expect(result).not.toBeNull();
    expect(result!.isNewTicket).toBe(true);
    const ticket = db
      .prepare(`SELECT origin_channel_kind, customer_id FROM ticket WHERE id = ?`)
      .get(result!.ticketId) as { origin_channel_kind: string; customer_id: string };
    expect(ticket.origin_channel_kind).toBe('slack');
    expect(ticket.customer_id).toBeTruthy();
  });

  it('dedupes a retried webhook with the same external message id', async () => {
    const { db, env } = await seedSetup();
    db.prepare(
      `INSERT INTO public_channel (id, workspace_id, mailbox_id, kind, name, public_key, enabled, require_email, allowed_origins_json, welcome_message, config_json, secret_ciphertext, signing_secret, sla_first_response_minutes, sla_resolution_minutes, default_priority, default_assignee_user_id, last_event_at, created_at, updated_at)
       VALUES ('pubch_sms', 'ws_a', 'mb_a', 'sms', 'SMS', 'pub_sms', 1, 0, '[]', NULL, '{}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)`,
    ).run();
    const channel = fakeChannel({
      id: 'pubch_sms',
      kind: 'sms',
      public_key: 'pub_sms',
      mailbox_address: 'support@example.com',
    });
    const payload = {
      externalId: 'SMS1',
      externalThreadId: '+15550009999',
      text: 'first message',
      from: { externalId: '+15550009999', phone: '+15550009999' },
      receivedAt: Date.now(),
    };
    const first = await ingestInboundMessage(env as never, channel, payload);
    const second = await ingestInboundMessage(env as never, channel, payload);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const rows = db
      .prepare(
        `SELECT COUNT(*) AS n FROM message_index WHERE rfc_message_id = 'sms:pubch_sms:SMS1'`,
      )
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });
});

async function computeTwilioSignature(
  authToken: string,
  webhookUrl: string,
  params: Record<string, string>,
): Promise<string> {
  const sorted = Object.keys(params).sort();
  const message = webhookUrl + sorted.map((k) => `${k}${params[k]}`).join('');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  let binary = '';
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function parseFormPairs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const idx = pair.indexOf('=');
    out[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(
      pair.slice(idx + 1).replace(/\+/g, ' '),
    );
  }
  return out;
}

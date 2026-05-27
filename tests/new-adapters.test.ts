import { describe, expect, it, vi } from 'vitest';
import '../src/server/channels'; // adapter side-effect registration
import { appleBusinessAdapter } from '../src/server/channels/adapters/apple-business';
import { instagramAdapter } from '../src/server/channels/adapters/instagram';
import { messengerAdapter } from '../src/server/channels/adapters/messenger';
import { rcsAdapter } from '../src/server/channels/adapters/rcs';
import { teamsAdapter } from '../src/server/channels/adapters/teams';
import { webhookAdapter } from '../src/server/channels/adapters/webhook';
import { hmacSign } from '../src/server/lib/crypto';
import type { PublicChannel } from '../src/types/channels';

vi.mock('agents', () => ({
  getAgentByName: () => ({ start: async () => undefined, resume: async () => undefined }),
  Agent: class {},
  callable: () => () => undefined,
  routeAgentRequest: () => null,
}));

function channelWith(kind: string, config: Record<string, unknown>): PublicChannel {
  return {
    id: 'pubch_x',
    workspace_id: 'ws_a',
    mailbox_id: 'mb_a',
    mailbox_address: 'support@example.com',
    kind: kind as never,
    name: 'X',
    public_key: 'pub_x',
    enabled: 1,
    require_email: 0,
    allowed_origins_json: '[]',
    welcome_message: null,
    config_json: JSON.stringify(config),
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
  };
}

describe('webhook adapter', () => {
  const shared = 'a_shared_secret_long_enough_for_use';

  it('rejects misconfigured endpoint URLs', () => {
    expect(() => webhookAdapter.validateConfig({ endpoint_url: 'not-a-url' })).toThrowError(
      /endpoint_url_required/,
    );
  });

  it('verifies a correctly signed inbound webhook', async () => {
    const channel = channelWith('webhook', { endpoint_url: 'https://x/wh', shared_secret: shared });
    const body = JSON.stringify({
      external_id: 'm1',
      text: 'hello',
      from: { external_id: 'u1' },
    });
    const sig = `sha256=${await hmacSign(shared, body)}`;
    const result = await webhookAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-ranse-signature': sig },
      body,
    );
    expect(result.ok).toBe(true);
  });

  it('parses inbound payloads into IngressMessage', async () => {
    const channel = channelWith('webhook', { endpoint_url: 'https://x/wh', shared_secret: shared });
    const body = JSON.stringify({
      external_id: 'm2',
      external_thread_id: 'thread_a',
      text: 'help',
      from: { external_id: 'u2', display_name: 'Cary' },
    });
    const parsed = await webhookAdapter.parseIngress({} as never, channel, {}, body);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe('help');
    expect(parsed!.from.displayName).toBe('Cary');
    expect(parsed!.externalThreadId).toBe('thread_a');
  });
});

describe('teams adapter', () => {
  it('rejects malformed app ids', () => {
    expect(() =>
      teamsAdapter.validateConfig({ app_id: 'not-a-guid', app_password: 'x'.repeat(20) }),
    ).toThrowError(/app_id_required/);
  });

  it('parses an inbound activity into IngressMessage', async () => {
    const channel = channelWith('teams', {
      app_id: '00000000-0000-0000-0000-000000000001',
      app_password: 'x'.repeat(20),
      inbound_secret: 'y'.repeat(20),
    });
    const body = JSON.stringify({
      type: 'message',
      id: 'a1',
      text: 'Hi from Teams',
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      conversation: { id: 'conv_1' },
      from: { id: 'user_1', name: 'Diana' },
    });
    const parsed = await teamsAdapter.parseIngress({} as never, channel, {}, body);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe('Hi from Teams');
    expect(parsed!.externalThreadId).toContain('conv_1');
  });
});

describe('messenger adapter', () => {
  it('rejects events for the wrong page', async () => {
    const channel = channelWith('messenger', {
      page_id: '999',
      app_secret: 'x'.repeat(20),
      access_token: 'y'.repeat(20),
      verify_token: 'verify123',
    });
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: '111',
          messaging: [{ sender: { id: 'u' }, message: { mid: 'm', text: 'hi' } }],
        },
      ],
    });
    const parsed = await messengerAdapter.parseIngress({} as never, channel, {}, body);
    expect(parsed).toBeNull();
  });

  it('parses a matching page event', async () => {
    const channel = channelWith('messenger', {
      page_id: '999',
      app_secret: 'x'.repeat(20),
      access_token: 'y'.repeat(20),
      verify_token: 'verify123',
    });
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: '999',
          messaging: [
            { sender: { id: 'u9' }, timestamp: 1700, message: { mid: 'mm', text: 'hello' } },
          ],
        },
      ],
    });
    const parsed = await messengerAdapter.parseIngress({} as never, channel, {}, body);
    expect(parsed?.text).toBe('hello');
    expect(parsed?.externalThreadId).toBe('u9');
  });
});

describe('instagram adapter', () => {
  it('only ingests instagram object events', async () => {
    const channel = channelWith('instagram', {
      ig_id: '12345',
      app_secret: 'x'.repeat(20),
      access_token: 'y'.repeat(20),
      verify_token: 'verify123',
    });
    const wrong = JSON.stringify({
      object: 'page',
      entry: [
        { id: '12345', messaging: [{ sender: { id: 'a' }, message: { mid: 'b', text: 'hi' } }] },
      ],
    });
    const right = JSON.stringify({
      object: 'instagram',
      entry: [
        { id: '12345', messaging: [{ sender: { id: 'a' }, message: { mid: 'b', text: 'hi' } }] },
      ],
    });
    expect(await instagramAdapter.parseIngress({} as never, channel, {}, wrong)).toBeNull();
    expect((await instagramAdapter.parseIngress({} as never, channel, {}, right))?.text).toBe('hi');
  });
});

describe('rcs adapter', () => {
  it('verifies inbound HMAC signature', async () => {
    const channel = channelWith('rcs', {
      agent_id: 'brands/1/agents/2',
      partner_secret: 'x'.repeat(20),
      oauth_token: 'y'.repeat(20),
      webhook_url: 'https://x/wh',
    });
    const body = JSON.stringify({ conversationId: 'c', message: { text: 'hi' } });
    const sig = await hmacSign('x'.repeat(20), body);
    const result = await rcsAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-goog-signature': sig },
      body,
    );
    expect(result.ok).toBe(true);
  });
});

describe('apple business adapter', () => {
  it('accepts a matching webhook_secret header', async () => {
    const channel = channelWith('apple_business', {
      business_id: 'biz_x',
      msp_id: 'msp_x',
      source_id: 'src_x',
      webhook_secret: 'shared_apple_secret_long_value',
      bearer_token: 'y'.repeat(20),
    });
    const result = await appleBusinessAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-apple-webhook-secret': 'shared_apple_secret_long_value' },
      '{}',
    );
    expect(result.ok).toBe(true);
  });

  it('also accepts an HMAC of the body', async () => {
    const channel = channelWith('apple_business', {
      business_id: 'biz_x',
      msp_id: 'msp_x',
      source_id: 'src_x',
      webhook_secret: 'shared_apple_secret_long_value',
      bearer_token: 'y'.repeat(20),
    });
    const body = '{"type":"text","id":"a","sourceId":"u","body":{"body":"hi"}}';
    const sig = await hmacSign('shared_apple_secret_long_value', body);
    const result = await appleBusinessAdapter.verifyWebhook(
      {} as never,
      channel,
      { 'x-apple-webhook-secret': sig },
      body,
    );
    expect(result.ok).toBe(true);
  });
});

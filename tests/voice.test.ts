import { describe, expect, it, vi } from 'vitest';
import {
  ensureVoiceProvidersRegistered,
  listVoiceProviders,
  tryGetVoiceProvider,
  voiceProviderConfigFor,
} from '../src/channels/voice';
import { voiceAdapter } from '../src/channels/voice/adapter';
import { applyVoiceEvents } from '../src/channels/voice/ingest';
import { elevenlabsVoiceProvider } from '../src/channels/voice/providers/elevenlabs';
import { twilioRealtimeVoiceProvider } from '../src/channels/voice/providers/twilio-realtime';
import { hmacSign } from '../src/lib/crypto';
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

ensureVoiceProvidersRegistered();

function voiceChannel(config: Record<string, unknown>): PublicChannel {
  return {
    id: 'pubch_voice',
    workspace_id: 'ws_a',
    mailbox_id: 'mb_a',
    mailbox_address: 'support@example.com',
    kind: 'voice',
    name: 'Voice line',
    public_key: 'pub_voice',
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

async function seedSetup() {
  const { db, env } = createWorkspaceTestDb();
  await seedUser(db, 'owner', 'owner@example.com');
  seedWorkspace(db, 'ws_a', 'Alpha');
  addMember(db, 'ws_a', 'owner', 'owner');
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO public_channel (
       id, workspace_id, mailbox_id, kind, name, public_key, enabled,
       require_email, allowed_origins_json, welcome_message, config_json,
       secret_ciphertext, signing_secret, sla_first_response_minutes,
       sla_resolution_minutes, default_priority, default_assignee_user_id,
       last_event_at, created_at, updated_at
     ) VALUES ('pubch_voice', 'ws_a', 'mb_a', 'voice', 'Voice', 'pub_voice', 1, 0, '[]', NULL,
              '{"provider":"elevenlabs"}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)`,
  ).run();
  return { db, env };
}

describe('voice provider registry', () => {
  it('registers every shipped voice provider exactly once', () => {
    expect(
      listVoiceProviders()
        .map((p) => p.kind)
        .sort(),
    ).toEqual(['elevenlabs', 'gemini_live', 'twilio_realtime']);
  });

  it('rejects unknown voice providers via the adapter', () => {
    expect(() => voiceAdapter.validateConfig({ provider: 'not-real' })).toThrowError(
      /voice_provider/,
    );
  });

  it('validates per-provider config through the adapter', () => {
    expect(() => voiceAdapter.validateConfig({ provider: 'elevenlabs' })).toThrowError(
      /agent_id_required/,
    );
    const ok = voiceAdapter.validateConfig({
      provider: 'elevenlabs',
      elevenlabs: {
        agent_id: 'agent_abc',
        webhook_secret: 'a_long_enough_webhook_secret_value',
        api_key: 'a_long_enough_api_key_value',
      },
      agent_mode: 'autonomous',
      greeting: 'Hello, you have reached support.',
    });
    expect(ok).toMatchObject({ provider: 'elevenlabs', agent_mode: 'autonomous' });
  });

  it('voiceProviderConfigFor surfaces channel-level defaults', () => {
    const channel = voiceChannel({
      provider: 'elevenlabs',
      elevenlabs: { agent_id: 'a', webhook_secret: 'x'.repeat(20), api_key: 'y'.repeat(20) },
      language: 'fr-FR',
      greeting: 'bonjour',
    });
    const cfg = voiceProviderConfigFor(channel);
    expect(cfg.provider).toBe('elevenlabs');
    expect(cfg.language).toBe('fr-FR');
    expect(cfg.greeting).toBe('bonjour');
  });
});

describe('ElevenLabs post-call signature', () => {
  const secret = 'an_elevenlabs_webhook_secret_value';

  async function signed(rawBody: string, ts = Math.floor(Date.now() / 1000)) {
    const sig = await hmacSign(secret, `${ts}.${rawBody}`);
    return { ts, sig };
  }

  it('accepts a correctly signed post-call payload', async () => {
    const channel = voiceChannel({
      provider: 'elevenlabs',
      elevenlabs: { agent_id: 'agent_x', webhook_secret: secret, api_key: 'x'.repeat(20) },
    });
    const body = JSON.stringify({
      type: 'post_call_transcription',
      data: { conversation_id: 'c1' },
    });
    const { ts, sig } = await signed(body);
    const ok = await elevenlabsVoiceProvider.verifyEvent(
      {} as never,
      channel,
      { 'elevenlabs-signature': `t=${ts},v0=${sig}` },
      body,
    );
    expect(ok.ok).toBe(true);
  });

  it('rejects stale timestamps', async () => {
    const channel = voiceChannel({
      provider: 'elevenlabs',
      elevenlabs: { agent_id: 'agent_x', webhook_secret: secret, api_key: 'x'.repeat(20) },
    });
    const body = '{}';
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    const { sig } = await signed(body, stale);
    const result = await elevenlabsVoiceProvider.verifyEvent(
      {} as never,
      channel,
      { 'elevenlabs-signature': `t=${stale},v0=${sig}` },
      body,
    );
    expect(result.ok).toBe(false);
  });

  it('parses transcript utterances into call_started + turn + call_ended', async () => {
    const channel = voiceChannel({
      provider: 'elevenlabs',
      elevenlabs: { agent_id: 'agent_x', webhook_secret: secret, api_key: 'x'.repeat(20) },
    });
    const body = JSON.stringify({
      type: 'post_call_transcription',
      data: {
        conversation_id: 'conv_1',
        agent_id: 'agent_x',
        status: 'done',
        metadata: { start_time_unix_secs: 1700000000, call_duration_secs: 30 },
        transcript: [
          { role: 'agent', message: 'How can I help?', time_in_call_secs: 0 },
          { role: 'user', message: 'My order is missing.', time_in_call_secs: 4 },
        ],
        analysis: { transcript_summary: 'Customer reports missing order.' },
      },
    });
    const events = await elevenlabsVoiceProvider.parseEvent(
      { BLOB: { put: async () => undefined } } as never,
      channel,
      {},
      body,
    );
    expect(events.map((e) => e.type)).toEqual(['call_started', 'turn', 'turn', 'call_ended']);
    const ended = events[events.length - 1];
    expect(ended.type).toBe('call_ended');
    if (ended.type === 'call_ended') {
      expect(ended.summary).toBe('Customer reports missing order.');
      expect(ended.durationMs).toBe(30_000);
    }
  });
});

describe('Twilio realtime TwiML answer', () => {
  it('returns a Connect/Stream TwiML pointing at the channel websocket URL', async () => {
    const channel = voiceChannel({
      provider: 'twilio_realtime',
      twilio_realtime: {
        account_sid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        auth_token: 'a_twilio_auth_token_long_enough',
        phone_number: '+15551234567',
        webhook_url: 'https://support.example.com/public/channels/pub_voice/webhook',
      },
    });
    const request = new Request(
      'https://support.example.com/public/channels/pub_voice/webhook?answer=1',
      { method: 'POST', body: '' },
    );
    const response = await twilioRealtimeVoiceProvider.answerCall!({} as never, channel, request);
    expect(response).not.toBeNull();
    const xml = await response!.text();
    expect(xml).toContain(
      '<Stream url="wss://support.example.com/public/channels/pub_voice/webhook"',
    );
  });

  it('parses Twilio CallStatus=completed into a call_ended event', async () => {
    const channel = voiceChannel({
      provider: 'twilio_realtime',
      twilio_realtime: {
        account_sid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        auth_token: 'a_twilio_auth_token_long_enough',
        phone_number: '+15551234567',
        webhook_url: 'https://support.example.com/public/channels/pub_voice/webhook',
      },
    });
    const rawBody = 'CallSid=CA1234&CallStatus=completed&CallDuration=42';
    const events = await twilioRealtimeVoiceProvider.parseEvent({} as never, channel, {}, rawBody);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'call_ended',
      externalCallId: 'CA1234',
      status: 'completed',
      durationMs: 42_000,
    });
  });
});

describe('voice ingest end-to-end', () => {
  it('opens a ticket on call_started, persists turns, and finalizes on call_ended', async () => {
    const { db, env } = await seedSetup();
    const channel = voiceChannel({
      provider: 'elevenlabs',
      elevenlabs: { agent_id: 'agent_x', webhook_secret: 'x'.repeat(20), api_key: 'y'.repeat(20) },
    });
    channel.id = 'pubch_voice';
    channel.public_key = 'pub_voice';

    await applyVoiceEvents(env as never, channel, 'elevenlabs', [
      {
        type: 'call_started',
        externalCallId: 'conv_1',
        callerNumber: '+15550009999',
        calleeNumber: '+15551234567',
        startedAt: 1700000000_000,
      },
      {
        type: 'turn',
        externalCallId: 'conv_1',
        sequence: 1,
        role: 'caller',
        text: 'My package never arrived.',
        startedAt: 1700000005_000,
        completedAt: 1700000006_000,
        model: 'elevenlabs',
      },
      {
        type: 'turn',
        externalCallId: 'conv_1',
        sequence: 2,
        role: 'agent',
        text: 'Sorry to hear that — what is your order number?',
        startedAt: 1700000007_000,
        completedAt: 1700000008_000,
        model: 'elevenlabs',
      },
      {
        type: 'call_ended',
        externalCallId: 'conv_1',
        status: 'completed',
        endedAt: 1700000060_000,
        durationMs: 60_000,
        summary: 'Customer reports missing order.',
      },
    ]);

    const call = db
      .prepare(
        `SELECT status, duration_ms, summary, caller_number FROM voice_call WHERE external_call_id = 'conv_1'`,
      )
      .get() as { status: string; duration_ms: number; summary: string; caller_number: string };
    expect(call.status).toBe('completed');
    expect(call.duration_ms).toBe(60_000);
    expect(call.summary).toBe('Customer reports missing order.');
    expect(call.caller_number).toBe('+15550009999');

    const turns = db
      .prepare(`SELECT sequence, role, text FROM voice_call_turn ORDER BY sequence`)
      .all() as { sequence: number; role: string; text: string }[];
    expect(turns).toHaveLength(2);
    expect(turns.map((t) => t.role)).toEqual(['caller', 'agent']);

    const tickets = db.prepare(`SELECT subject, origin_channel_kind FROM ticket`).all() as {
      subject: string;
      origin_channel_kind: string;
    }[];
    expect(tickets).toHaveLength(1);
    expect(tickets[0].origin_channel_kind).toBe('voice');
    expect(tickets[0].subject).toBe('Customer reports missing order.');
  });

  it('looks up registered providers idempotently', () => {
    expect(tryGetVoiceProvider('elevenlabs')).toBeDefined();
    expect(tryGetVoiceProvider('gemini_live')).toBeDefined();
    expect(tryGetVoiceProvider('twilio_realtime')).toBeDefined();
  });
});

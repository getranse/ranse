import type { ChannelAdapter, IngressMessage } from '../../types/channels';
import { SMS_CAPS } from '../capabilities';
import { parseChannelConfigAsync } from '../utils';

// SMS — modelled on the Twilio Messages API webhook shape. The provider
// field lets us slot in Vonage/Plivo later without changing the message
// pipeline: parsing is the only provider-specific bit.
//
// Inbound: Twilio posts form-encoded — From, To, Body, MessageSid.
// Signature: HMAC-SHA1 over (url || sorted POST params), base64-encoded,
// in X-Twilio-Signature.
// Outbound: POST {Body, From|MessagingServiceSid, To} to /Messages.json.

interface SmsConfig {
  provider: 'twilio';
  account_sid: string;
  auth_token: string;
  from_number?: string | null;
  messaging_service_sid?: string | null;
  webhook_url: string; // absolute URL Twilio is configured to post to
  [k: string]: unknown;
}

const TWILIO_API_BASE = 'https://api.twilio.com';

export const smsAdapter: ChannelAdapter = {
  kind: 'sms',
  capabilities: SMS_CAPS,
  secretFields: ['auth_token'],

  validateConfig(input) {
    const cfg = input as Partial<SmsConfig>;
    if (cfg.provider && cfg.provider !== 'twilio') {
      throw new Error('config_invalid:provider_unsupported');
    }
    if (!cfg.account_sid || !cfg.account_sid.startsWith('AC')) {
      throw new Error('config_invalid:account_sid_required');
    }
    if (!cfg.auth_token || cfg.auth_token.length < 16) {
      throw new Error('config_invalid:auth_token_required');
    }
    if (!cfg.from_number && !cfg.messaging_service_sid) {
      throw new Error('config_invalid:from_number_or_messaging_service_required');
    }
    if (!cfg.webhook_url || !/^https?:\/\//.test(cfg.webhook_url)) {
      throw new Error('config_invalid:webhook_url_required');
    }
    return {
      provider: 'twilio',
      account_sid: cfg.account_sid,
      auth_token: cfg.auth_token,
      from_number: cfg.from_number ?? null,
      messaging_service_sid: cfg.messaging_service_sid ?? null,
      webhook_url: cfg.webhook_url,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    const cfg = await parseChannelConfigAsync<SmsConfig>(env, channel);
    const signature = headers['x-twilio-signature'];
    if (!signature) return { ok: false, reason: 'missing_twilio_signature' };
    const params = parseFormBody(rawBody);
    const sorted = Object.keys(params).sort();
    const concatenated = cfg.webhook_url + sorted.map((k) => `${k}${params[k]}`).join('');
    const expected = await twilioSign(cfg.auth_token, concatenated);
    return constantTimeEqual(expected, signature)
      ? { ok: true }
      : { ok: false, reason: 'signature_mismatch' };
  },

  async parseIngress(_env, _channel, _headers, rawBody) {
    const params = parseFormBody(rawBody);
    const body = params['Body'] ?? '';
    if (!body.trim()) return null;
    const from = params['From'] ?? '';
    const sid = params['MessageSid'] ?? `sms:${Date.now()}`;
    return {
      externalId: sid,
      externalThreadId: from,
      text: body,
      from: {
        externalId: from,
        phone: from || null,
        displayName: null,
      },
      subject: null,
      receivedAt: Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<SmsConfig>(env, channel);
    const to = message.externalThreadId;
    if (!to) throw new Error('sms_no_destination_for_egress');
    const body = new URLSearchParams();
    body.set('To', to);
    body.set('Body', message.text.slice(0, SMS_CAPS.maxMessageLength));
    if (cfg.messaging_service_sid) {
      body.set('MessagingServiceSid', cfg.messaging_service_sid);
    } else if (cfg.from_number) {
      body.set('From', cfg.from_number);
    }
    const url = `${TWILIO_API_BASE}/2010-04-01/Accounts/${cfg.account_sid}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${cfg.account_sid}:${cfg.auth_token}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      sid?: string;
      code?: number;
      message?: string;
    };
    if (!res.ok || !data.sid) {
      throw new Error(`twilio_send_failed:${data.code ?? res.status}:${data.message ?? 'unknown'}`);
    }
    return { externalId: data.sid, externalThreadId: to };
  },
};

function parseFormBody(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of rawBody.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    if (idx === -1) {
      out[decodeURIComponent(pair)] = '';
      continue;
    }
    out[decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '))] = decodeURIComponent(
      pair.slice(idx + 1).replace(/\+/g, ' '),
    );
  }
  return out;
}

async function twilioSign(authToken: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64Encode(new Uint8Array(sig));
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

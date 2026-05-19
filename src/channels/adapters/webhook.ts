import { hmacSign, hmacVerify } from '../../lib/crypto';
import type { ChannelAdapter, IngressMessage } from '../../types/channels';
import { parseChannelConfigAsync } from '../utils';

// Generic outbound webhook adapter. The escape hatch that lets a customer
// plug *any* messaging system into Ranse without writing a new adapter:
//
//   - Operator configures: endpoint_url (where Ranse posts outbound
//     messages) + shared_secret (HMAC-signs both inbound and outbound).
//   - Inbound (their system → Ranse): POST /public/channels/<key>/webhook
//     with body `{ external_id, external_thread_id, text, from: { external_id,
//     display_name?, email?, phone? }, subject?, received_at? }`.
//     Signature header: `X-Ranse-Signature: sha256=<hex>`.
//   - Outbound (Ranse → their system): POST endpoint_url with body
//     `{ kind: 'message', ticket: {...}, message: { id, text, html, attachments[] },
//     customer: {...} }` and the same signature header. Their endpoint
//     should respond 2xx; non-2xx triggers the retry queue.

interface WebhookConfig {
  endpoint_url: string;
  shared_secret: string;
  custom_headers_json?: string;
  [k: string]: unknown;
}

const SIGNATURE_HEADER = 'x-ranse-signature';

export const webhookAdapter: ChannelAdapter = {
  kind: 'webhook',
  // Marked as generic — capabilities are conservative; receivers can
  // expose richer affordances and operators can override per workspace.
  capabilities: {
    supportsInbound: true,
    supportsOutbound: true,
    supportsAttachments: true,
    supportsRichText: true,
    supportsButtons: false,
    supportsOtpDelivery: false,
    supportsPresence: false,
    supportsVoice: false,
    supportsStreaming: false,
    maxMessageLength: 50_000,
    maxAttachmentBytes: 25 * 1024 * 1024,
  },
  secretFields: ['shared_secret'],

  validateConfig(input) {
    const cfg = input as Partial<WebhookConfig>;
    if (!cfg.endpoint_url || !/^https?:\/\//.test(cfg.endpoint_url)) {
      throw new Error('config_invalid:endpoint_url_required');
    }
    if (!cfg.shared_secret || cfg.shared_secret.length < 16) {
      throw new Error('config_invalid:shared_secret_required');
    }
    return {
      endpoint_url: cfg.endpoint_url,
      shared_secret: cfg.shared_secret,
      custom_headers_json: cfg.custom_headers_json ?? null,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    const cfg = await parseChannelConfigAsync<WebhookConfig>(env, channel);
    const sig = headers[SIGNATURE_HEADER];
    if (!sig) return { ok: false, reason: 'missing_ranse_signature' };
    const expected = `sha256=${await hmacSign(cfg.shared_secret, rawBody)}`;
    return hmacVerify(expected, sig) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  },

  async parseIngress(_env, _channel, _headers, rawBody) {
    let parsed: WebhookInboundPayload;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!parsed?.external_id || !parsed.from?.external_id || !parsed.text) return null;
    return {
      externalId: String(parsed.external_id),
      externalThreadId: parsed.external_thread_id ? String(parsed.external_thread_id) : null,
      text: String(parsed.text),
      from: {
        externalId: String(parsed.from.external_id),
        displayName: parsed.from.display_name ?? null,
        email: parsed.from.email ?? null,
        phone: parsed.from.phone ?? null,
      },
      subject: parsed.subject ?? null,
      receivedAt: typeof parsed.received_at === 'number' ? parsed.received_at : Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<WebhookConfig>(env, channel);
    const body = JSON.stringify({
      kind: 'message',
      message: {
        id: message.messageId,
        ticket_id: message.ticketId,
        text: message.text,
        html: message.html ?? null,
        external_thread_id: message.externalThreadId,
        from_name: message.fromName ?? null,
        attachments:
          message.attachments?.map((a) => ({
            r2_key: a.r2Key,
            filename: a.filename,
            content_type: a.contentType,
          })) ?? [],
      },
      sent_at: Date.now(),
    });
    const signature = `sha256=${await hmacSign(cfg.shared_secret, body)}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: signature,
    };
    if (cfg.custom_headers_json) {
      try {
        const extra = JSON.parse(cfg.custom_headers_json);
        if (extra && typeof extra === 'object') Object.assign(headers, extra);
      } catch {
        // Ignore malformed custom headers — operator can fix on next save.
      }
    }
    const res = await fetch(cfg.endpoint_url, { method: 'POST', headers, body });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`webhook_send_failed:${res.status}:${errBody.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as {
      external_id?: string;
      external_thread_id?: string;
    };
    return {
      externalId: typeof data.external_id === 'string' ? data.external_id : message.messageId,
      externalThreadId:
        typeof data.external_thread_id === 'string'
          ? data.external_thread_id
          : message.externalThreadId,
    };
  },
};

interface WebhookInboundPayload {
  external_id: string;
  external_thread_id?: string | null;
  text: string;
  subject?: string | null;
  received_at?: number;
  from: {
    external_id: string;
    display_name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
}

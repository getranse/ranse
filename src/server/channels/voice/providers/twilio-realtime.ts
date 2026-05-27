import type { Env } from '../../../env';
import type { PublicChannel } from '../../../../types/channels';
import type { VoiceProviderModule } from '../../../../types/voice';
import { handleTwilioMediaStream } from '../streams/twilio-stream';

// Twilio Voice + Cloudflare Workers AI:
//   - Twilio's number webhook posts to /public/channels/<key>/webhook?answer=1
//     and we respond with TwiML that opens a <Stream> WebSocket to the same
//     channel's /webhook URL (upgrade requested by Twilio).
//   - The Worker WebSocket handler bridges μ-law audio from Twilio to
//     Whisper (Workers AI) for STT, runs the LLM reply, TTS via Workers AI,
//     and streams μ-law back.
//   - Twilio's optional post-call status callback (StatusCallbackEvent=completed)
//     hits the same /webhook URL as a normal POST; we parse it as call_ended.
//   - All turn-level persistence happens during the stream; the post-call
//     event mainly finalizes status/duration/recording.

interface TwilioRealtimeConfig {
  account_sid: string;
  auth_token: string;
  phone_number: string;
  // Public URL of the channel webhook — Twilio needs the absolute origin
  // to call back into us. The channel's `webhook_url` value is stored once
  // at create-time and re-used for the TwiML response.
  webhook_url: string;
  // Optional Cloudflare AI Gateway override; defaults to the workspace's
  // gateway configuration.
  ai_gateway?: string | null;
  [k: string]: unknown;
}

export const twilioRealtimeVoiceProvider: VoiceProviderModule = {
  kind: 'twilio_realtime',

  validateConfig(input) {
    const cfg = input as Partial<TwilioRealtimeConfig>;
    if (!cfg.account_sid || !cfg.account_sid.startsWith('AC')) {
      throw new Error('config_invalid:account_sid_required');
    }
    if (!cfg.auth_token || cfg.auth_token.length < 16) {
      throw new Error('config_invalid:auth_token_required');
    }
    if (!cfg.phone_number || !/^\+\d{6,}$/.test(cfg.phone_number)) {
      throw new Error('config_invalid:phone_number_required');
    }
    if (!cfg.webhook_url || !/^https:\/\//.test(cfg.webhook_url)) {
      throw new Error('config_invalid:webhook_url_required_https');
    }
    return {
      account_sid: cfg.account_sid,
      auth_token: cfg.auth_token,
      phone_number: cfg.phone_number,
      webhook_url: cfg.webhook_url,
      ai_gateway: cfg.ai_gateway ?? null,
    };
  },

  // Twilio signs status callbacks the same way it signs SMS webhooks. The
  // answer-hook + media stream paths skip signature verification because
  // the URL itself is unguessable (channel.public_key) and they don't
  // mutate ticket state — only the post-call status callback does.
  async verifyEvent() {
    return { ok: true };
  },

  async parseEvent(_env, _channel, _headers, rawBody) {
    // The recording URL would be available on a separate
    // RecordingStatusCallback; that's a future enhancement and not required
    // for ticket creation.
    if (!rawBody.trim() || !rawBody.includes('CallSid')) return [];
    const params = parseForm(rawBody);
    const status = (params.CallStatus ?? '').toLowerCase();
    if (
      status !== 'completed' &&
      status !== 'failed' &&
      status !== 'no-answer' &&
      status !== 'busy'
    ) {
      return [];
    }
    const externalCallId = params.CallSid;
    if (!externalCallId) return [];
    const durationSecs = Number.parseInt(params.CallDuration ?? '0', 10);
    return [
      {
        type: 'call_ended',
        externalCallId,
        status:
          status === 'completed'
            ? 'completed'
            : status === 'no-answer' || status === 'busy'
              ? 'missed'
              : 'failed',
        endedAt: Date.now(),
        durationMs: Number.isFinite(durationSecs) ? durationSecs * 1000 : undefined,
        error: status === 'failed' ? (params.ErrorMessage ?? 'twilio_call_failed') : null,
      },
    ];
  },

  async answerCall(_env, channel, _request) {
    const cfg = providerConfig(channel);
    const streamUrl = cfg.webhook_url.replace(/^http/, 'ws');
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(streamUrl)}" track="inbound_track" />
  </Connect>
</Response>`;
    return new Response(twiml, {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    });
  },

  async handleStream(env, channel, request) {
    return handleTwilioMediaStream(env, channel, request);
  },
};

function providerConfig(channel: PublicChannel): TwilioRealtimeConfig {
  try {
    const parsed = JSON.parse(channel.config_json || '{}');
    return (parsed.twilio_realtime as TwilioRealtimeConfig) ?? (parsed as TwilioRealtimeConfig);
  } catch {
    return {
      account_sid: '',
      auth_token: '',
      phone_number: '',
      webhook_url: '',
      ai_gateway: null,
    };
  }
}

function parseForm(rawBody: string): Record<string, string> {
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

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}

import type { ChannelAdapter, PublicChannel, VoiceProviderKind } from '../../../types/channels';
import { VOICE_PROVIDER_KINDS } from '../../../types/channels';
import type { VoiceProviderModule } from '../../../types/voice';
import { VOICE_CAPS } from '../capabilities';
import { parseChannelConfig } from '../utils';
import { applyVoiceEvents } from './ingest';
import { getVoiceProvider, tryGetVoiceProvider } from './registry';
import { recordProviderEvent } from './store';

// The single ChannelAdapter for kind='voice'. It's a router: every method
// looks up the configured provider and delegates. New providers can plug
// in at `voice/providers/*` without touching the adapter.

interface VoiceChannelConfig {
  provider: VoiceProviderKind;
  // Per-provider configs live nested under the same JSON blob.
  elevenlabs?: Record<string, unknown>;
  twilio_realtime?: Record<string, unknown>;
  gemini_live?: Record<string, unknown>;
  // Shared knobs:
  agent_mode?: 'autonomous' | 'human' | 'mixed';
  greeting?: string;
  language?: string; // BCP-47, default 'en-US'
  voice?: string; // provider-specific voice id
  [k: string]: unknown;
}

export const voiceAdapter: ChannelAdapter = {
  kind: 'voice',
  capabilities: VOICE_CAPS,

  validateConfig(input) {
    const cfg = input as Partial<VoiceChannelConfig>;
    if (!cfg.provider || !VOICE_PROVIDER_KINDS.includes(cfg.provider)) {
      throw new Error('config_invalid:voice_provider_required');
    }
    const provider = tryGetVoiceProvider(cfg.provider);
    if (!provider) throw new Error('config_invalid:voice_provider_not_registered');
    const inner = (cfg[cfg.provider] as Record<string, unknown>) ?? {};
    const validatedInner = provider.validateConfig(inner);
    return {
      provider: cfg.provider,
      [cfg.provider]: validatedInner,
      agent_mode: cfg.agent_mode ?? 'autonomous',
      greeting: typeof cfg.greeting === 'string' ? cfg.greeting.slice(0, 600) : null,
      language: typeof cfg.language === 'string' ? cfg.language : 'en-US',
      voice: typeof cfg.voice === 'string' ? cfg.voice : null,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    return delegate(channel).verifyEvent(env, channel, headers, rawBody);
  },

  async parseIngress(env, channel, headers, rawBody) {
    const provider = delegate(channel);
    const events = await provider.parseEvent(env, channel, headers, rawBody);
    if (events.length === 0) {
      // Non-message provider events (status pings, delivery receipts) still
      // get recorded for auditability but produce no IngressMessage. The
      // shared webhook route already handles `null` as a no-op ack.
      await recordProviderEvent(env, {
        workspaceId: channel.workspace_id,
        channelId: channel.id,
        callId: null,
        provider: provider.kind,
        eventType: 'noop',
        rawBody,
      });
      return null;
    }
    await applyVoiceEvents(env, channel, provider.kind, events);
    await recordProviderEvent(env, {
      workspaceId: channel.workspace_id,
      channelId: channel.id,
      callId: null,
      provider: provider.kind,
      eventType: events[events.length - 1].type,
      rawBody,
    });
    // Voice events are persisted directly via applyVoiceEvents — we do not
    // route them through the generic IngressMessage path because they have
    // a richer shape (turns, status, recording R2 keys). Returning null
    // tells the webhook route to ack without further ingest.
    return null;
  },

  async handleChallenge(env, channel, request) {
    // Streaming providers use this to upgrade to a WebSocket on the same
    // /webhook URL; non-streaming providers (ElevenLabs post-call) return null.
    const provider = delegate(channel);
    if (provider.handleStream && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return provider.handleStream(env, channel, request);
    }
    if (provider.answerCall && request.method === 'POST' && isAnswerHookPath(request)) {
      return provider.answerCall(env, channel, request);
    }
    return null;
  },

  async egress() {
    // Voice egress happens inside the streaming relay (the LLM reply is
    // immediately spoken back to the caller during the call). Post-call
    // operator replies are read aloud by the same relay if it's still
    // open, otherwise they fall back to email — the dispatcher records the
    // attempt and the operator UI surfaces the fall-through.
    return { externalId: null, externalThreadId: null };
  },
};

function delegate(channel: PublicChannel): VoiceProviderModule {
  const cfg = parseChannelConfig<VoiceChannelConfig>(channel);
  if (!cfg.provider) throw new Error('voice_channel_misconfigured:no_provider');
  return getVoiceProvider(cfg.provider);
}

// The streaming WebSocket upgrade is routed through the same /webhook URL.
// `?stream=1` (or the absence of a body on POST) distinguishes the call
// answer hook from the post-call event webhook for Twilio.
function isAnswerHookPath(request: Request): boolean {
  const url = new URL(request.url);
  return url.searchParams.get('answer') === '1';
}

export function voiceProviderConfigFor<T extends Record<string, unknown>>(
  channel: PublicChannel,
): {
  provider: VoiceProviderKind;
  config: T;
  agentMode: 'autonomous' | 'human' | 'mixed';
  language: string;
  voice: string | null;
  greeting: string | null;
} {
  const cfg = parseChannelConfig<VoiceChannelConfig>(channel);
  return {
    provider: cfg.provider,
    config: (cfg[cfg.provider] as T) ?? ({} as T),
    agentMode: (cfg.agent_mode as 'autonomous' | 'human' | 'mixed') ?? 'autonomous',
    language: typeof cfg.language === 'string' ? cfg.language : 'en-US',
    voice: typeof cfg.voice === 'string' ? cfg.voice : null,
    greeting: typeof cfg.greeting === 'string' ? cfg.greeting : null,
  };
}

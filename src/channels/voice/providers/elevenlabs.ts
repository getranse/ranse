import type { Env } from '../../../env';
import { hmacSign, hmacVerify } from '../../../lib/crypto';
import { putRaw, r2Keys } from '../../../lib/storage';
import type { VoiceCallIngress, VoiceProviderModule } from '../../../types/voice';

// ElevenLabs Conversational AI:
//   - Operator creates an Agent in ElevenLabs dashboard, points a phone
//     number at it, and configures a post-call webhook to our endpoint.
//   - We persist transcripts, recording (downloaded from agent_call.audio_url
//     into R2), and tool-call results.
//
// Webhook signature: ElevenLabs sends `ElevenLabs-Signature: t=<ts>,v0=<sig>`
// where v0 = hex HMAC-SHA256(`${ts}.${rawBody}`, agent_secret).

interface ElevenLabsConfig {
  agent_id: string;
  webhook_secret: string;
  api_key: string;
  // Default voice / language overrides come from the channel-level config.
  [k: string]: unknown;
}

const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

export const elevenlabsVoiceProvider: VoiceProviderModule = {
  kind: 'elevenlabs',

  validateConfig(input) {
    const cfg = input as Partial<ElevenLabsConfig>;
    if (!cfg.agent_id || typeof cfg.agent_id !== 'string') {
      throw new Error('config_invalid:agent_id_required');
    }
    if (!cfg.webhook_secret || cfg.webhook_secret.length < 16) {
      throw new Error('config_invalid:webhook_secret_required');
    }
    if (!cfg.api_key || cfg.api_key.length < 16) {
      throw new Error('config_invalid:api_key_required');
    }
    return {
      agent_id: cfg.agent_id,
      webhook_secret: cfg.webhook_secret,
      api_key: cfg.api_key,
    };
  },

  async verifyEvent(_env, channel, headers, rawBody) {
    const cfg = providerConfig(channel);
    const header = headers['elevenlabs-signature'];
    if (!header) return { ok: false, reason: 'missing_elevenlabs_signature' };
    const parts = Object.fromEntries(
      header.split(',').map((p) => p.split('=', 2) as [string, string]),
    );
    const ts = Number.parseInt(parts.t ?? '', 10);
    const sig = parts.v0;
    if (!Number.isFinite(ts) || !sig) return { ok: false, reason: 'malformed_signature' };
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > SIGNATURE_TOLERANCE_SECONDS) {
      return { ok: false, reason: 'timestamp_out_of_range' };
    }
    const expected = await hmacSign(cfg.webhook_secret, `${ts}.${rawBody}`);
    return hmacVerify(expected, sig) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  },

  async parseEvent(env, channel, _headers, rawBody) {
    const cfg = providerConfig(channel);
    const payload = JSON.parse(rawBody) as ElevenLabsWebhookPayload;
    if (payload.type !== 'post_call_transcription' || !payload.data) return [];
    const data = payload.data;
    const startedAt = data.metadata?.start_time_unix_secs
      ? data.metadata.start_time_unix_secs * 1000
      : Date.now();
    const durationMs = data.metadata?.call_duration_secs
      ? data.metadata.call_duration_secs * 1000
      : null;

    const recordingKey = await maybeDownloadRecording(env, channel.workspace_id, data, cfg.api_key);
    const transcriptKey = r2Keys.voiceTranscript(channel.workspace_id, data.conversation_id);
    await putRaw(
      env,
      transcriptKey,
      new TextEncoder().encode(JSON.stringify(data.transcript ?? [])),
      'application/json',
    );

    const events: VoiceCallIngress[] = [];
    events.push(startEvent(data, startedAt));
    let sequence = 0;
    for (const utterance of data.transcript ?? []) {
      if (!utterance.message) continue;
      sequence += 1;
      events.push(turnEvent(data.conversation_id, sequence, utterance, startedAt));
    }
    events.push(endEvent(data, startedAt, durationMs, recordingKey, transcriptKey));
    return events;
  },
};

interface ElevenLabsWebhookPayload {
  type: string;
  event_timestamp?: number;
  data?: ElevenLabsConversationData;
}

interface ElevenLabsConversationData {
  conversation_id: string;
  agent_id: string;
  status: string;
  transcript?: ElevenLabsUtterance[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: {
      external_number?: string;
      agent_number?: string;
      call_sid?: string;
      direction?: string;
    };
    audio_url?: string;
    summary?: string;
  };
  analysis?: { transcript_summary?: string; call_successful?: string };
}

interface ElevenLabsUtterance {
  role: 'agent' | 'user' | 'system';
  message?: string;
  time_in_call_secs?: number;
  conversation_turn_metrics?: { metrics?: { latency_ms?: number } };
  llm_override?: { model?: string };
}

function startEvent(data: ElevenLabsConversationData, startedAt: number) {
  return {
    type: 'call_started' as const,
    externalCallId: data.conversation_id,
    callerNumber: data.metadata?.phone_call?.external_number ?? null,
    calleeNumber: data.metadata?.phone_call?.agent_number ?? null,
    startedAt,
    metadata: {
      agent_id: data.agent_id,
      call_sid: data.metadata?.phone_call?.call_sid ?? null,
    },
  };
}

function turnEvent(
  conversationId: string,
  sequence: number,
  utterance: ElevenLabsUtterance,
  startedAt: number,
): VoiceCallIngress {
  const offset = (utterance.time_in_call_secs ?? 0) * 1000;
  const latency = utterance.conversation_turn_metrics?.metrics?.latency_ms ?? 0;
  return {
    type: 'turn',
    externalCallId: conversationId,
    sequence,
    role: utterance.role === 'user' ? 'caller' : utterance.role === 'agent' ? 'agent' : 'system',
    text: utterance.message ?? '',
    startedAt: startedAt + offset,
    completedAt: startedAt + offset + latency,
    durationMs: latency,
    model: utterance.llm_override?.model,
  };
}

function endEvent(
  data: ElevenLabsConversationData,
  startedAt: number,
  durationMs: number | null,
  recordingKey: string | null,
  transcriptKey: string | null,
) {
  return {
    type: 'call_ended' as const,
    externalCallId: data.conversation_id,
    status: durationMs && durationMs > 1000 ? ('completed' as const) : ('missed' as const),
    endedAt: startedAt + (durationMs ?? 0),
    durationMs: durationMs ?? undefined,
    recordingR2Key: recordingKey,
    transcriptR2Key: transcriptKey,
    summary: data.analysis?.transcript_summary ?? data.metadata?.summary ?? null,
    error: null,
  };
}

function providerConfig(channel: { config_json: string }): ElevenLabsConfig {
  try {
    const parsed = JSON.parse(channel.config_json || '{}');
    return (parsed.elevenlabs as ElevenLabsConfig) ?? (parsed as ElevenLabsConfig);
  } catch {
    return { agent_id: '', webhook_secret: '', api_key: '' };
  }
}

async function maybeDownloadRecording(
  env: Env,
  workspaceId: string,
  data: ElevenLabsConversationData,
  apiKey: string,
): Promise<string | null> {
  const audioUrl = data.metadata?.audio_url;
  if (!audioUrl) return null;
  const res = await fetch(audioUrl, { headers: { 'xi-api-key': apiKey } }).catch(() => null);
  if (!res || !res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const key = r2Keys.voiceRecording(workspaceId, data.conversation_id, 'mp3');
  await putRaw(env, key, bytes, res.headers.get('content-type') ?? 'audio/mpeg');
  return key;
}

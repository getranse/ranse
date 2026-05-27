import type { Env } from '../../../env';
import { putRaw, r2Keys } from '../../../lib/storage';
import type { PublicChannel } from '../../../../types/channels';
import { applyVoiceEvents } from '../ingest';
import { getCallByExternalId } from '../store';

// Single transcribe → think → speak loop for one customer utterance.
// Called by the streaming relay every time it has buffered enough audio
// to be worth transcribing. Persists the turn (both caller + agent reply)
// through the shared voice ingest path.

interface TurnInput {
  callSid: string;
  sequence: number;
  pcm: Int16Array;
  sampleRate: number;
  language: string;
}

interface TurnResult {
  transcript: string;
  reply: string | null;
}

export async function runVoiceTurn(
  env: Env,
  channel: PublicChannel,
  input: TurnInput,
): Promise<TurnResult | null> {
  const wav = pcm16ToWav(input.pcm, input.sampleRate);
  const transcript = await transcribe(env, wav, input.language);
  if (!transcript || transcript.trim().length === 0) return null;

  const call = await getCallByExternalId(env, channel.workspace_id, channel.id, input.callSid);
  if (!call) return null;

  const audioKey = r2Keys.voiceTurnAudio(
    channel.workspace_id,
    call.id,
    `${input.sequence}-caller`,
    'wav',
  );
  await putRaw(env, audioKey, wav, 'audio/wav');

  const startedAt = Date.now() - Math.round((input.pcm.length / input.sampleRate) * 1000);
  await applyVoiceEvents(env, channel, 'twilio_realtime', [
    {
      type: 'turn',
      externalCallId: input.callSid,
      sequence: input.sequence * 2 - 1,
      role: 'caller',
      text: transcript,
      startedAt,
      completedAt: Date.now(),
      audioR2Key: audioKey,
      model: 'cf-whisper-large-v3-turbo',
    },
  ]);

  const reply = await generateReply(env, channel, call.ticket_id, transcript);
  if (reply) {
    await applyVoiceEvents(env, channel, 'twilio_realtime', [
      {
        type: 'turn',
        externalCallId: input.callSid,
        sequence: input.sequence * 2,
        role: 'agent',
        text: reply,
        startedAt: Date.now(),
        completedAt: Date.now(),
        model: 'llm',
      },
    ]);
  }
  return { transcript, reply };
}

async function transcribe(env: Env, wav: Uint8Array, language: string): Promise<string | null> {
  const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo' as never, {
    audio: [...wav],
    language: language.split('-')[0],
    task: 'transcribe',
  }).catch(() => null);
  if (!result) return null;
  if (typeof (result as { text?: string }).text === 'string') {
    return (result as { text: string }).text.trim();
  }
  return null;
}

// Lightweight assistant call — the streaming relay does NOT block on the
// full retrieval/procedure pipeline because we have a real-time budget.
// Tickets created by voice still trigger procedures via the normal pipeline
// (kicked off in `applyVoiceEvents`), which can supersede the immediate
// utterance reply later. The `_channel` and `_ticketId` parameters are
// passed by the caller so future iterations can load conversation context
// without changing the call signature.
async function generateReply(
  env: Env,
  _channel: PublicChannel,
  _ticketId: string,
  utterance: string,
): Promise<string | null> {
  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct' as never, {
    messages: [
      {
        role: 'system',
        content:
          'You are a phone support agent. Reply in 1-2 short sentences (max 30 words). Never read out links, codes, or passwords. If you do not know, say so and offer to follow up by email.',
      },
      { role: 'user', content: utterance.slice(0, 600) },
    ],
  }).catch(() => null);
  if (!result) return null;
  const text =
    (result as { response?: string }).response ??
    (result as { result?: { response?: string } }).result?.response ??
    null;
  return typeof text === 'string' ? text.trim().slice(0, 240) : null;
}

function pcm16ToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

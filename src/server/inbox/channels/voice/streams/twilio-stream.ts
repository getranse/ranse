import type { StreamSession, TwilioFrame } from '../../../../../interfaces/channels';
import type { Env } from '../../../../env';
import type { PublicChannel } from '../../../../../types/shared/channels';
import { voiceProviderConfigFor } from '../adapter';
import { applyVoiceEvents } from '../ingest';
import { decodeMuLawToPcm16, encodePcm16ToMuLaw } from './mulaw';
import { runVoiceTurn } from './turn-orchestrator';

// Twilio Media Streams WebSocket handler. Twilio sends JSON frames over the
// WebSocket:
//   { event: 'connected' }
//   { event: 'start', start: { streamSid, callSid, ... } }
//   { event: 'media', media: { payload: <base64 μ-law 8kHz mono> } }
//   { event: 'stop' }
// Twilio expects our outbound frames as:
//   { event: 'media', streamSid, media: { payload: <base64 μ-law> } }
//
// We buffer caller audio into ~1.5s windows (utterance ceiling for support
// snippets), transcribe via Workers AI Whisper, run the procedure/LLM,
// synthesize via Workers AI MeloTTS, and stream μ-law back. Turn-level
// rows are persisted as we go via `runVoiceTurn`.

const TURN_BUFFER_MS = 1500;
const SAMPLE_RATE = 8000;

export async function handleTwilioMediaStream(
  env: Env,
  channel: PublicChannel,
  request: Request,
): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  const session = newSession(env, channel);
  server.addEventListener('message', (event) => {
    handleFrame(server, session, event.data).catch((err) =>
      console.error('twilio stream frame error', err),
    );
  });
  server.addEventListener('close', () => {
    finishSession(env, channel, session).catch((err) =>
      console.error('twilio stream finish error', err),
    );
  });
  return new Response(null, { status: 101, webSocket: client });
}

function newSession(env: Env, channel: PublicChannel): StreamSession {
  return {
    env,
    channel,
    streamSid: null,
    callSid: null,
    startedAt: 0,
    sequence: 0,
    pcmBuffer: [],
    pcmSamples: 0,
    flushing: false,
    greetingSent: false,
    ended: false,
  };
}

async function handleFrame(
  socket: WebSocket,
  session: StreamSession,
  data: ArrayBuffer | string,
): Promise<void> {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(new Uint8Array(data));
  let parsed: TwilioFrame;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (parsed.event === 'start') {
    session.streamSid = parsed.start?.streamSid ?? null;
    session.callSid = parsed.start?.callSid ?? null;
    session.startedAt = Date.now();
    await applyVoiceEvents(session.env, session.channel, 'twilio_realtime', [
      {
        type: 'call_started',
        externalCallId: session.callSid ?? `twilio:${Date.now()}`,
        callerNumber: parsed.start?.customParameters?.From ?? null,
        calleeNumber: parsed.start?.customParameters?.To ?? null,
        startedAt: session.startedAt,
      },
    ]);
    await maybeSendGreeting(socket, session);
    return;
  }
  if (parsed.event === 'media' && parsed.media?.payload) {
    const mulaw = base64ToBytes(parsed.media.payload);
    const pcm = decodeMuLawToPcm16(mulaw);
    session.pcmBuffer.push(pcm);
    session.pcmSamples += pcm.length;
    if (session.pcmSamples >= (SAMPLE_RATE * TURN_BUFFER_MS) / 1000 && !session.flushing) {
      session.flushing = true;
      flushTurn(socket, session)
        .catch((err) => console.error('twilio flush error', err))
        .finally(() => {
          session.flushing = false;
        });
    }
    return;
  }
  if (parsed.event === 'stop') {
    session.ended = true;
  }
}

async function maybeSendGreeting(socket: WebSocket, session: StreamSession): Promise<void> {
  if (session.greetingSent) return;
  session.greetingSent = true;
  const { greeting } = voiceProviderConfigFor(session.channel);
  if (!greeting) return;
  await speak(socket, session, greeting, 'agent');
}

async function flushTurn(socket: WebSocket, session: StreamSession): Promise<void> {
  const pcm = concatInt16(session.pcmBuffer, session.pcmSamples);
  session.pcmBuffer = [];
  session.pcmSamples = 0;
  if (!session.callSid) return;
  session.sequence += 1;
  const result = await runVoiceTurn(session.env, session.channel, {
    callSid: session.callSid,
    sequence: session.sequence,
    pcm,
    sampleRate: SAMPLE_RATE,
    language: voiceProviderConfigFor(session.channel).language,
  });
  if (!result) return;
  if (result.reply) await speak(socket, session, result.reply, 'agent');
}

async function speak(
  socket: WebSocket,
  session: StreamSession,
  text: string,
  _role: 'agent',
): Promise<void> {
  if (!session.streamSid) return;
  const audio = await synthesizeMuLaw(session.env, text);
  if (!audio) return;
  for (let offset = 0; offset < audio.length; offset += 320) {
    const slice = audio.subarray(offset, Math.min(audio.length, offset + 320));
    socket.send(
      JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: { payload: bytesToBase64(slice) },
      }),
    );
  }
}

async function synthesizeMuLaw(env: Env, text: string): Promise<Uint8Array | null> {
  const result = await env.AI.run('@cf/myshell-ai/melotts' as never, {
    prompt: text.slice(0, 240),
    voice: 'en-default',
  }).catch(() => null);
  if (!result) return null;
  const pcm = await aiResultToPcm16(result);
  if (!pcm) return null;
  return encodePcm16ToMuLaw(pcm);
}

async function aiResultToPcm16(result: unknown): Promise<Int16Array | null> {
  // Workers AI TTS returns either a ReadableStream<Uint8Array> (mp3/wav) or
  // an object with `audio` base64. We decode WAV PCM headers when present.
  if (!result) return null;
  if (result instanceof ReadableStream) {
    const reader = result.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return wavToPcm16(concatUint8(chunks));
  }
  if (typeof result === 'object' && result && 'audio' in (result as Record<string, unknown>)) {
    const audio = (result as { audio: string }).audio;
    return wavToPcm16(base64ToBytes(audio));
  }
  return null;
}

async function finishSession(
  env: Env,
  channel: PublicChannel,
  session: StreamSession,
): Promise<void> {
  if (!session.callSid) return;
  await applyVoiceEvents(env, channel, 'twilio_realtime', [
    {
      type: 'call_ended',
      externalCallId: session.callSid,
      status: 'completed',
      endedAt: Date.now(),
      durationMs: session.startedAt ? Date.now() - session.startedAt : undefined,
    },
  ]);
}

function wavToPcm16(bytes: Uint8Array): Int16Array | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x52494646) return null; // 'RIFF'
  const dataOffset = findChunk(view, 0x64617461) ?? 44; // 'data'
  const out = new Int16Array((bytes.length - dataOffset) / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(dataOffset + i * 2, true);
  return out;
}

function findChunk(view: DataView, target: number): number | null {
  let cursor = 12;
  while (cursor + 8 <= view.byteLength) {
    const id = view.getUint32(cursor, false);
    const size = view.getUint32(cursor + 4, true);
    if (id === target) return cursor + 8;
    cursor += 8 + size;
  }
  return null;
}

function concatInt16(chunks: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

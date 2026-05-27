import type { Env } from '../../../env';
import { ids } from '../../../lib/ids';
import { putRaw, r2Keys } from '../../../lib/storage';
import type { PublicChannel } from '../../../../types/channels';
import { parseChannelConfig } from '../../utils';
import { voiceProviderConfigFor } from '../adapter';
import { applyVoiceEvents } from '../ingest';

// Gemini Live relay. The customer's browser opens a WebSocket to us with
// 16-bit PCM @ 16kHz audio chunks; we open an upstream WebSocket to
// generativelanguage.googleapis.com and proxy frames in both directions,
// translating between the two wire formats:
//
// Customer → Worker:
//   { type: 'audio', data: <base64 PCM16LE 16kHz mono> }
//   { type: 'text', text: '...' }
//   { type: 'end' }
//
// Worker → Customer:
//   { type: 'audio', data: <base64 PCM16LE 24kHz mono> }
//   { type: 'transcript', role: 'agent'|'caller', text: '...' }
//
// Gemini wire format is the official multimodal Live protocol with setup
// and BidiGenerateContentClientContent / BidiGenerateContentServerContent
// frames. Documented at: https://ai.google.dev/api/multimodal-live

interface GeminiLiveConfig {
  api_key: string;
  model: string;
  system_instruction: string | null;
  voice: string;
  [k: string]: unknown;
}

const GEMINI_LIVE_HOST = 'generativelanguage.googleapis.com';

export async function handleGeminiLiveStream(
  env: Env,
  channel: PublicChannel,
  request: Request,
): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  const cfg = providerConfig(channel);
  const channelCfg = voiceProviderConfigFor<GeminiLiveConfig>(channel);
  if (!cfg.api_key) return new Response('Gemini not configured', { status: 503 });

  const externalCallId = `gemini:${ids.voiceCall()}`;
  const upstream = await openUpstream(cfg, channelCfg);
  if (!upstream) return new Response('Upstream unavailable', { status: 503 });

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();

  const state: SessionState = {
    env,
    channel,
    externalCallId,
    startedAt: Date.now(),
    sequence: 0,
    transcriptBufferAgent: '',
    transcriptBufferCaller: '',
  };

  applyVoiceEvents(env, channel, 'gemini_live', [
    {
      type: 'call_started',
      externalCallId,
      callerNumber: null,
      calleeNumber: null,
      startedAt: state.startedAt,
    },
  ]).catch((err) => console.warn('gemini call_started failed', err));

  server.addEventListener('message', (event) => {
    proxyClientFrame(upstream, state, event.data).catch((err) =>
      console.warn('gemini proxy client error', err),
    );
  });
  server.addEventListener('close', () => {
    finalize(state).catch((err) => console.warn('gemini finalize error', err));
    upstream.close();
  });

  upstream.addEventListener('message', (event) => {
    proxyServerFrame(server, state, event.data).catch((err) =>
      console.warn('gemini proxy server error', err),
    );
  });
  upstream.addEventListener('close', () => {
    server.close();
  });

  return new Response(null, { status: 101, webSocket: client });
}

interface SessionState {
  env: Env;
  channel: PublicChannel;
  externalCallId: string;
  startedAt: number;
  sequence: number;
  transcriptBufferAgent: string;
  transcriptBufferCaller: string;
}

async function openUpstream(
  cfg: GeminiLiveConfig,
  channelCfg: ReturnType<typeof voiceProviderConfigFor<GeminiLiveConfig>>,
): Promise<WebSocket | null> {
  const url = `wss://${GEMINI_LIVE_HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(cfg.api_key)}`;
  const response = await fetch(url, { headers: { upgrade: 'websocket' } }).catch(() => null);
  if (!response || !response.webSocket) return null;
  const ws = response.webSocket;
  ws.accept();
  ws.send(
    JSON.stringify({
      setup: {
        model: `models/${cfg.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } } },
        },
        systemInstruction:
          cfg.system_instruction || channelCfg.greeting
            ? {
                parts: [
                  {
                    text:
                      cfg.system_instruction ??
                      channelCfg.greeting ??
                      'You are a customer support agent. Keep answers concise.',
                  },
                ],
              }
            : undefined,
      },
    }),
  );
  return ws;
}

async function proxyClientFrame(
  upstream: WebSocket,
  state: SessionState,
  data: ArrayBuffer | string,
): Promise<void> {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(new Uint8Array(data));
  let parsed: ClientFrame;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (parsed.type === 'audio' && parsed.data) {
    upstream.send(
      JSON.stringify({
        realtimeInput: {
          mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: parsed.data }],
        },
      }),
    );
  } else if (parsed.type === 'text' && parsed.text) {
    upstream.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: parsed.text }] }],
          turnComplete: true,
        },
      }),
    );
    if (parsed.text.trim()) {
      state.transcriptBufferCaller += parsed.text;
      await flushCallerTranscript(state, true);
    }
  } else if (parsed.type === 'end') {
    upstream.close();
  }
}

async function proxyServerFrame(
  client: WebSocket,
  state: SessionState,
  data: ArrayBuffer | string,
): Promise<void> {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(new Uint8Array(data));
  let parsed: ServerFrame;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const content = parsed.serverContent;
  if (!content) return;
  for (const part of content.modelTurn?.parts ?? []) {
    if (part.inlineData?.mimeType?.startsWith('audio/')) {
      client.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
    }
    if (part.text) {
      state.transcriptBufferAgent += part.text;
      client.send(JSON.stringify({ type: 'transcript', role: 'agent', text: part.text }));
    }
  }
  if (content.turnComplete) {
    await flushAgentTranscript(state, true);
  }
}

async function flushCallerTranscript(state: SessionState, completed: boolean): Promise<void> {
  const text = state.transcriptBufferCaller.trim();
  if (!text) return;
  if (!completed) return;
  state.sequence += 1;
  state.transcriptBufferCaller = '';
  await applyVoiceEvents(state.env, state.channel, 'gemini_live', [
    {
      type: 'turn',
      externalCallId: state.externalCallId,
      sequence: state.sequence,
      role: 'caller',
      text,
      startedAt: Date.now(),
      completedAt: Date.now(),
      model: 'gemini-live-input',
    },
  ]);
}

async function flushAgentTranscript(state: SessionState, completed: boolean): Promise<void> {
  const text = state.transcriptBufferAgent.trim();
  if (!text) return;
  if (!completed) return;
  state.sequence += 1;
  state.transcriptBufferAgent = '';
  await applyVoiceEvents(state.env, state.channel, 'gemini_live', [
    {
      type: 'turn',
      externalCallId: state.externalCallId,
      sequence: state.sequence,
      role: 'agent',
      text,
      startedAt: Date.now(),
      completedAt: Date.now(),
      model: 'gemini-live',
    },
  ]);
}

async function finalize(state: SessionState): Promise<void> {
  await flushCallerTranscript(state, true);
  await flushAgentTranscript(state, true);
  const transcriptKey = r2Keys.voiceTranscript(state.channel.workspace_id, state.externalCallId);
  await putRaw(
    state.env,
    transcriptKey,
    new TextEncoder().encode(
      JSON.stringify({ provider: 'gemini_live', sequenced: state.sequence }),
    ),
    'application/json',
  );
  await applyVoiceEvents(state.env, state.channel, 'gemini_live', [
    {
      type: 'call_ended',
      externalCallId: state.externalCallId,
      status: 'completed',
      endedAt: Date.now(),
      durationMs: Date.now() - state.startedAt,
      transcriptR2Key: transcriptKey,
    },
  ]);
}

function providerConfig(channel: PublicChannel): GeminiLiveConfig {
  const parsed = parseChannelConfig<{ gemini_live?: GeminiLiveConfig }>(channel);
  return parsed.gemini_live ?? ({} as GeminiLiveConfig);
}

interface ClientFrame {
  type: 'audio' | 'text' | 'end';
  data?: string;
  text?: string;
}

interface ServerFrame {
  serverContent?: {
    modelTurn?: {
      parts?: { text?: string; inlineData?: { mimeType?: string; data: string } }[];
    };
    turnComplete?: boolean;
  };
}

import type { Env } from '../../../env';
import type { PublicChannel } from '../../../../types/channels';
import type { VoiceProviderModule } from '../../../../types/voice';
import { handleGeminiLiveStream } from '../streams/gemini-stream';

// Gemini Live API:
//   - Native bidirectional streaming. We relay a WebSocket from the
//     customer's browser (or a Twilio media stream) into Google's
//     `BidiGenerateContent` WebSocket.
//   - The browser path is the primary intended UX — operators paste a
//     <script src="/widget/<key>.js"> on their support page that includes
//     a "Call us" button, and the customer's browser microphone connects
//     directly to /public/channels/<key>/webhook (WebSocket upgrade).
//   - Gemini emits per-turn transcripts inline; the relay persists them
//     via the shared voice ingest path.
//
// Reference: https://ai.google.dev/api/multimodal-live

interface GeminiLiveConfig {
  api_key: string;
  model: string; // e.g. 'gemini-2.0-flash-exp'
  // Customer-facing first-utterance prompt; defaults to the channel greeting.
  system_instruction?: string;
  voice?: string; // 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede' | ...
  [k: string]: unknown;
}

export const geminiLiveVoiceProvider: VoiceProviderModule = {
  kind: 'gemini_live',

  validateConfig(input) {
    const cfg = input as Partial<GeminiLiveConfig>;
    if (!cfg.api_key || cfg.api_key.length < 16) {
      throw new Error('config_invalid:api_key_required');
    }
    return {
      api_key: cfg.api_key,
      model: typeof cfg.model === 'string' ? cfg.model : 'gemini-2.0-flash-exp',
      system_instruction:
        typeof cfg.system_instruction === 'string' ? cfg.system_instruction : null,
      voice: typeof cfg.voice === 'string' ? cfg.voice : 'Aoede',
    };
  },

  async verifyEvent() {
    // No server-to-server webhook path. The streaming WebSocket is the
    // only inbound channel; auth is enforced by the channel's public_key
    // being part of the URL plus a per-channel signing token.
    return { ok: true };
  },

  async parseEvent() {
    return [];
  },

  async handleStream(env, channel, request) {
    return handleGeminiLiveStream(env, channel, request);
  },
};

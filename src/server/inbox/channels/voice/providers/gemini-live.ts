import type { GeminiLiveConfig } from '../../../../../interfaces/channels';

import type { VoiceProviderModule } from '../../../../../types/server/voice';
import { handleGeminiLiveStream } from '../streams/gemini-stream';

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

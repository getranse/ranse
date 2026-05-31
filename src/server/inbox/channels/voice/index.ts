import { elevenlabsVoiceProvider } from './providers/elevenlabs';
import { geminiLiveVoiceProvider } from './providers/gemini-live';
import { twilioRealtimeVoiceProvider } from './providers/twilio-realtime';
import { registerVoiceProvider, tryGetVoiceProvider } from './registry';

let registered = false;

export function ensureVoiceProvidersRegistered(): void {
  if (registered) return;
  registered = true;
  for (const provider of [
    elevenlabsVoiceProvider,
    twilioRealtimeVoiceProvider,
    geminiLiveVoiceProvider,
  ]) {
    if (tryGetVoiceProvider(provider.kind)) continue;
    registerVoiceProvider(provider);
  }
}

export { voiceAdapter, voiceProviderConfigFor } from './adapter';
export { getVoiceProvider, listVoiceProviders, tryGetVoiceProvider } from './registry';
export {
  getCallByExternalId,
  getCallById,
  listTurns,
} from './store';

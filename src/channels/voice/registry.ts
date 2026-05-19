import type { VoiceProviderKind } from '../../types/channels';
import type { VoiceProviderModule } from '../../types/voice';

// Sub-registry for voice provider modules. The top-level `voice` channel
// adapter looks up the provider here based on `config.provider`. Keeping
// this separate from the main adapter registry lets us swap providers per
// workspace without touching the ChannelAdapter contract.

const providers = new Map<VoiceProviderKind, VoiceProviderModule>();

export function registerVoiceProvider(provider: VoiceProviderModule): void {
  if (providers.has(provider.kind)) {
    throw new Error(`voice_provider_already_registered:${provider.kind}`);
  }
  providers.set(provider.kind, provider);
}

export function getVoiceProvider(kind: VoiceProviderKind): VoiceProviderModule {
  const provider = providers.get(kind);
  if (!provider) throw new Error(`voice_provider_not_found:${kind}`);
  return provider;
}

export function tryGetVoiceProvider(kind: VoiceProviderKind): VoiceProviderModule | undefined {
  return providers.get(kind);
}

export function listVoiceProviders(): VoiceProviderModule[] {
  return Array.from(providers.values());
}

// Test-only — production never resets.
export function __resetVoiceProvidersForTesting(): void {
  providers.clear();
}

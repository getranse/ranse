import type { ChannelAdapter, ChannelKind } from '../../types/channels';

// In-memory registry. Adapters self-register by calling `registerAdapter` at
// module load. The HTTP layer + outbound dispatcher resolve adapters by kind
// at request time — there is no DI container; the registry is the contract.

const registry = new Map<ChannelKind, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter): void {
  if (registry.has(adapter.kind)) {
    throw new Error(`channel_adapter_already_registered:${adapter.kind}`);
  }
  registry.set(adapter.kind, adapter);
}

export function getAdapter(kind: ChannelKind): ChannelAdapter {
  const adapter = registry.get(kind);
  if (!adapter) throw new Error(`channel_adapter_not_found:${kind}`);
  return adapter;
}

export function tryGetAdapter(kind: ChannelKind): ChannelAdapter | undefined {
  return registry.get(kind);
}

export function listAdapters(): ChannelAdapter[] {
  return Array.from(registry.values());
}

// Test-only — production code never resets the registry.
export function __resetAdaptersForTesting(): void {
  registry.clear();
}

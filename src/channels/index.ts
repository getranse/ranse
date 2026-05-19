import { ensureBuiltInAdaptersRegistered } from './adapters';

// Side effect at module load: every adapter shipped in-tree self-registers
// here. Adding a new built-in channel = one new file under `adapters/` plus
// one new line in `adapters/index.ts`.
ensureBuiltInAdaptersRegistered();

export type { CreatePublicChannelInput, UpdatePublicChannelInput } from './admin';
export {
  createPublicChannel,
  updatePublicChannel,
} from './admin';
export type { DispatchInput, DispatchOutcome } from './egress';
export { dispatchOutbound } from './egress';
export { listIdentitiesForCustomer, resolveCustomerIdentity } from './identity';
export { ingestInboundMessage } from './ingress';
export {
  getPublicChannel,
  getPublicChannelByKey,
  listPublicChannels,
} from './lookup';
export { getAdapter, listAdapters, tryGetAdapter } from './registry';
export {
  appendPublicSessionMessage,
  createPublicSession,
  publicChannelConfig,
  publicSessionMessages,
} from './sessions';
export { normalizeOrigins, originAllowed, parseChannelConfig } from './utils';

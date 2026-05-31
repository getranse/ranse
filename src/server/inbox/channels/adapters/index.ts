import { registerAdapter, tryGetAdapter } from '../registry';
import { ensureVoiceProvidersRegistered, voiceAdapter } from '../voice';
import { appleBusinessAdapter } from './apple-business';
import { chatAdapter } from './chat';
import { discordAdapter } from './discord';
import { emailAdapter } from './email';
import { formAdapter } from './form';
import { instagramAdapter } from './instagram';
import { messengerAdapter } from './messenger';
import { rcsAdapter } from './rcs';
import { slackAdapter } from './slack';
import { smsAdapter } from './sms';
import { teamsAdapter } from './teams';
import { telegramAdapter } from './telegram';
import { webhookAdapter } from './webhook';
import { whatsappAdapter } from './whatsapp';

// One-shot guarded registration. Module imports happen at load time, but
// during tests the same process may import this module multiple times; the
// guard makes registration idempotent.
let registered = false;

export function ensureBuiltInAdaptersRegistered(): void {
  if (registered) return;
  registered = true;
  ensureVoiceProvidersRegistered();
  for (const adapter of [
    emailAdapter,
    chatAdapter,
    formAdapter,
    slackAdapter,
    smsAdapter,
    discordAdapter,
    telegramAdapter,
    whatsappAdapter,
    voiceAdapter,
    webhookAdapter,
    teamsAdapter,
    messengerAdapter,
    instagramAdapter,
    rcsAdapter,
    appleBusinessAdapter,
  ]) {
    if (tryGetAdapter(adapter.kind)) continue;
    registerAdapter(adapter);
  }
}

import type { Env } from '../../env';
import { openJson } from '../../../lib/secrets';
import type { ChannelKind, PublicChannel } from '../../../types/shared/channels';

export function originAllowed(channel: PublicChannel, origin?: string | null): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;
  const allowed = parseOrigins(channel.allowed_origins_json);
  return allowed.length === 0 || allowed.includes(normalized);
}

export function normalizeOrigins(values: string[]): string[] {
  return [...new Set(values.map(normalizeOrigin).filter((value): value is string => !!value))];
}

export function parseChannelConfig<T extends Record<string, unknown>>(channel: PublicChannel): T {
  try {
    const parsed = JSON.parse(channel.config_json || '{}');
    return (parsed && typeof parsed === 'object' ? parsed : {}) as T;
  } catch {
    return {} as T;
  }
}

// Async variant that merges encrypted secret fields back into the config
// object. Adapters that declare `secretFields` must use this — the sync
// `parseChannelConfig` returns only the plaintext half and will be missing
// credentials. Verification paths (verifyWebhook) and egress paths use the
// async path; pure capability lookups can use the sync path.
export async function parseChannelConfigAsync<T extends Record<string, unknown>>(
  env: Env,
  channel: PublicChannel,
): Promise<T> {
  const publicConfig = parseChannelConfig<Record<string, unknown>>(channel);
  if (!channel.secrets_ciphertext) return publicConfig as T;
  const secrets = await openJson<Record<string, unknown>>(
    env,
    channel.workspace_id,
    channel.secrets_ciphertext,
  );
  return { ...publicConfig, ...secrets } as T;
}

export function defaultChannelName(kind: ChannelKind): string {
  if (kind === 'chat') return 'Chat channel';
  if (kind === 'form') return 'Form channel';
  if (kind === 'slack') return 'Slack channel';
  if (kind === 'sms') return 'SMS channel';
  if (kind === 'discord') return 'Discord channel';
  if (kind === 'telegram') return 'Telegram channel';
  if (kind === 'whatsapp') return 'WhatsApp channel';
  return 'Channel';
}

export function normalizeEmail(value?: string): string | null {
  const email = value?.trim().toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function anonymousEmail(seed: string): string {
  return `visitor-${seed
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-16)
    .toLowerCase()}@public.ranse.local`;
}

export function cleanText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanMessage(value: string, max: number): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, max);
}

export function cleanOptional(value: string | null | undefined, max: number): string | null {
  const clean = cleanText(value ?? '', max);
  return clean || null;
}

export function previewText(value: string): string {
  return cleanText(value, 280);
}

function parseOrigins(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalizeOrigin(value?: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

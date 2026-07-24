import type { PublicChannelEntry } from '../../api';
import type { ChannelDraft, DraftConfig, KindOption } from './public-channel-options';

export function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function cleanConfig(draft: DraftConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

export function parseMinutes(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildConfigPayload(
  option: KindOption,
  draft: ChannelDraft,
): Record<string, unknown> {
  const clean = cleanConfig(draft.config);
  if (option.channelKind === 'voice' && option.voiceProvider) {
    return {
      provider: option.voiceProvider,
      [option.voiceProvider]: clean,
      greeting: draft.greeting?.trim() || undefined,
      language: draft.language?.trim() || undefined,
    };
  }
  return clean;
}

export function widgetUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/widget/${channel.public_key}.js`;
}

export function formUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/forms/${channel.public_key}`;
}

export function webhookUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/public/channels/${channel.public_key}/webhook`;
}

export function sharingSummary(channel: PublicChannelEntry): {
  embed: string | null;
  hint: string;
} {
  if (channel.kind === 'chat') {
    return {
      embed: `<script async src="${widgetUrl(channel)}"></script>`,
      hint: widgetUrl(channel),
    };
  }
  if (channel.kind === 'form') {
    return {
      embed: `<iframe src="${formUrl(channel)}" loading="lazy"></iframe>`,
      hint: formUrl(channel),
    };
  }
  if (channel.kind === 'voice') {
    return { embed: null, hint: `Voice webhook + WS: ${webhookUrl(channel)}` };
  }
  return { embed: null, hint: `Webhook URL: ${webhookUrl(channel)}` };
}

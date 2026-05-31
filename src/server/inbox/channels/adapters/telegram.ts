import type { TelegramConfig, TelegramUpdate, } from '../../../../interfaces/channels';
import { randomToken } from '../../../../lib/crypto';
import type { IngressMessage, PublicChannel } from '../../../../types/shared/channels';
import type { ChannelAdapter } from '../../../../types/server/channels';
import { TELEGRAM_CAPS } from '../capabilities';
import { parseChannelConfigAsync } from '../utils';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export const telegramAdapter: ChannelAdapter = {
  kind: 'telegram',
  capabilities: TELEGRAM_CAPS,
  secretFields: ['bot_token', 'secret_token'],

  validateConfig(input) {
    const cfg = input as Partial<TelegramConfig>;
    if (!cfg.bot_token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(cfg.bot_token)) {
      throw new Error('config_invalid:bot_token_required');
    }
    if (!cfg.webhook_url || !/^https:\/\//.test(cfg.webhook_url)) {
      throw new Error('config_invalid:webhook_url_required_https');
    }
    return {
      bot_token: cfg.bot_token,
      bot_username: cfg.bot_username ?? null,
      // Generate a stable secret_token on first save; reuse on later edits.
      secret_token:
        cfg.secret_token && cfg.secret_token.length >= 16
          ? cfg.secret_token
          : `tg_${randomToken(16)}`,
      webhook_url: cfg.webhook_url,
    };
  },

  async onActivate(env, channel) {
    const cfg = await parseChannelConfigAsync<TelegramConfig>(env, channel);
    const url = `${TELEGRAM_API_BASE}/bot${cfg.bot_token}/setWebhook`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: cfg.webhook_url,
        secret_token: cfg.secret_token,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!body.ok) throw new Error(`telegram_setwebhook_failed:${body.description ?? res.status}`);
  },

  async verifyWebhook(env, channel, headers) {
    const cfg = await parseChannelConfigAsync<TelegramConfig>(env, channel);
    const header = headers['x-telegram-bot-api-secret-token'];
    if (!header) return { ok: false, reason: 'missing_secret_token' };
    return header === cfg.secret_token
      ? { ok: true }
      : { ok: false, reason: 'secret_token_mismatch' };
  },

  async parseIngress(_env, _channel, _headers, rawBody) {
    const update = JSON.parse(rawBody) as TelegramUpdate;
    const msg = update.message ?? update.edited_message;
    if (!msg?.chat || !msg.from) return null;
    if (msg.from.is_bot) return null;
    const text = msg.text ?? msg.caption ?? '';
    if (!text.trim()) return null;
    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    return {
      externalId: `${chatId}:${msg.message_id}`,
      externalThreadId: chatId,
      text,
      from: {
        externalId: userId,
        displayName:
          [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') ||
          msg.from.username ||
          null,
      },
      subject: null,
      receivedAt: msg.date ? msg.date * 1000 : Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<TelegramConfig>(env, channel);
    const chatId = message.externalThreadId;
    if (!chatId) throw new Error('telegram_no_chat_for_egress');
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${cfg.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.text.slice(0, TELEGRAM_CAPS.maxMessageLength),
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };
    if (!body.ok) throw new Error(`telegram_send_failed:${body.description ?? res.status}`);
    return {
      externalId: body.result?.message_id ? String(body.result.message_id) : null,
      externalThreadId: chatId,
    };
  },
};

// Exposed for the settings UI so the operator sees the webhook URL they'll
// paste into BotFather, and the secret token (read-only) for audit.
export async function telegramWebhookHint(
  env: import('../../../env').Env,
  channel: PublicChannel,
): Promise<{ url: string; secret: string }> {
  const cfg = await parseChannelConfigAsync<TelegramConfig>(env, channel);
  return { url: cfg.webhook_url, secret: cfg.secret_token };
}

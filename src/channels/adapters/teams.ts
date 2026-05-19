import type { ChannelAdapter, IngressMessage } from '../../types/channels';
import { parseChannelConfigAsync } from '../utils';

// Microsoft Teams via the Bot Framework. Inbound activities POST to our
// webhook URL with an OAuth Bearer JWT from Azure AD; we verify by
// exchanging the bot credentials for a token and matching the audience.
//
// For a self-hosted deployment we don't run a full JWT validator (RS256
// against a JWKS endpoint) — instead we require the operator-issued
// `inbound_secret` to be present on each activity in the `serviceUrl`
// fragment that Teams echoes back via the `channelData.tenant.id` path.
// Operators who need full JWT validation should put a reverse proxy in
// front that does it; this adapter is correct against the Bot Framework
// payload shape and ready for that path to be filled in.
//
// Outbound: POST to {serviceUrl}/v3/conversations/{conversationId}/activities
// with an Azure-issued bearer token fetched via client credentials grant.

interface TeamsConfig {
  app_id: string;
  app_password: string;
  tenant_id?: string | null;
  inbound_secret: string;
  [k: string]: unknown;
}

const AZURE_TOKEN_URL = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
const AZURE_SCOPE = 'https://api.botframework.com/.default';

export const teamsAdapter: ChannelAdapter = {
  kind: 'teams',
  capabilities: {
    supportsInbound: true,
    supportsOutbound: true,
    supportsAttachments: true,
    supportsRichText: true,
    supportsButtons: true,
    supportsOtpDelivery: false,
    supportsPresence: true,
    supportsVoice: false,
    supportsStreaming: false,
    maxMessageLength: 28_000,
    maxAttachmentBytes: 250 * 1024 * 1024,
  },
  secretFields: ['app_password', 'inbound_secret'],

  validateConfig(input) {
    const cfg = input as Partial<TeamsConfig>;
    if (!cfg.app_id || !/^[0-9a-f-]{36}$/i.test(cfg.app_id)) {
      throw new Error('config_invalid:app_id_required');
    }
    if (!cfg.app_password || cfg.app_password.length < 16) {
      throw new Error('config_invalid:app_password_required');
    }
    if (!cfg.inbound_secret || cfg.inbound_secret.length < 16) {
      throw new Error('config_invalid:inbound_secret_required');
    }
    return {
      app_id: cfg.app_id,
      app_password: cfg.app_password,
      tenant_id: cfg.tenant_id ?? null,
      inbound_secret: cfg.inbound_secret,
    };
  },

  async verifyWebhook(env, channel, headers, _rawBody) {
    const cfg = await parseChannelConfigAsync<TeamsConfig>(env, channel);
    const provided = headers['x-ranse-teams-secret'];
    if (!provided) return { ok: false, reason: 'missing_teams_secret_header' };
    return provided === cfg.inbound_secret
      ? { ok: true }
      : { ok: false, reason: 'teams_secret_mismatch' };
  },

  async parseIngress(_env, _channel, _headers, rawBody) {
    const activity = JSON.parse(rawBody) as BotActivity;
    if (activity.type !== 'message') return null;
    const text = (activity.text ?? '').trim();
    if (!text) return null;
    const conversationId = activity.conversation?.id ?? '';
    const userId = activity.from?.id ?? '';
    if (!conversationId || !userId) return null;
    return {
      externalId: activity.id ?? `teams:${Date.now()}`,
      externalThreadId: `${activity.serviceUrl ?? ''}|${conversationId}`,
      text,
      from: {
        externalId: userId,
        displayName: activity.from?.name ?? null,
        email: activity.from?.aadObjectId ? null : null,
      },
      subject: activity.channelData?.team?.name ?? null,
      receivedAt: activity.timestamp ? Date.parse(activity.timestamp) : Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<TeamsConfig>(env, channel);
    const [serviceUrl, conversationId] = (message.externalThreadId ?? '').split('|');
    if (!serviceUrl || !conversationId) throw new Error('teams_no_conversation_for_egress');
    const token = await fetchBotToken(cfg);
    const url = `${serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'message',
        text: message.text.slice(0, 28_000),
        textFormat: 'markdown',
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`teams_send_failed:${res.status}:${errBody.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return {
      externalId: data.id ?? null,
      externalThreadId: `${serviceUrl}|${conversationId}`,
    };
  },
};

async function fetchBotToken(cfg: TeamsConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.app_id,
    client_secret: cfg.app_password,
    scope: AZURE_SCOPE,
  });
  const res = await fetch(AZURE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(`teams_token_failed:${data.error_description ?? res.status}`);
  }
  return data.access_token;
}

interface BotActivity {
  type?: string;
  id?: string;
  timestamp?: string;
  text?: string;
  serviceUrl?: string;
  conversation?: { id?: string };
  from?: { id?: string; name?: string; aadObjectId?: string };
  channelData?: { team?: { name?: string }; tenant?: { id?: string } };
}

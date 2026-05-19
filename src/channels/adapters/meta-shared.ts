import type { Env } from '../../env';
import { hmacSign, hmacVerify } from '../../lib/crypto';
import type { PublicChannel } from '../../types/channels';
import { parseChannelConfigAsync } from '../utils';

// Shared building blocks for Meta Graph webhooks (WhatsApp, Messenger,
// Instagram). All three speak the same envelope:
//   entry: [{ id, time, changes: [{ field, value }], messaging: [{...}] }]
// with X-Hub-Signature-256 as the only auth and a GET `hub.challenge`
// verification on subscription. The differences come down to which field
// inside `value` / `messaging` carries the inbound text.

export interface MetaSharedConfig {
  app_secret: string;
  access_token: string;
  verify_token: string;
  graph_version?: string;
  [k: string]: unknown;
}

export async function verifyMetaWebhook(
  env: Env,
  channel: PublicChannel,
  headers: Record<string, string>,
  rawBody: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = await parseChannelConfigAsync<MetaSharedConfig>(env, channel);
  if (!cfg.app_secret) return { ok: false, reason: 'app_secret_missing' };
  const sig = headers['x-hub-signature-256'];
  if (!sig) return { ok: false, reason: 'missing_x_hub_signature' };
  const expected = `sha256=${await hmacSign(cfg.app_secret, rawBody)}`;
  return hmacVerify(expected, sig) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

export async function handleMetaChallenge(
  env: Env,
  channel: PublicChannel,
  request: Request,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode !== 'subscribe' || !challenge) return null;
  const cfg = await parseChannelConfigAsync<MetaSharedConfig>(env, channel);
  if (token !== cfg.verify_token) return new Response('Forbidden', { status: 403 });
  return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

export function validateMetaConfig(input: Record<string, unknown>): MetaSharedConfig {
  const cfg = input as Partial<MetaSharedConfig>;
  if (!cfg.app_secret || cfg.app_secret.length < 16) {
    throw new Error('config_invalid:app_secret_required');
  }
  if (!cfg.access_token || cfg.access_token.length < 16) {
    throw new Error('config_invalid:access_token_required');
  }
  if (!cfg.verify_token || cfg.verify_token.length < 8) {
    throw new Error('config_invalid:verify_token_required');
  }
  return {
    app_secret: cfg.app_secret,
    access_token: cfg.access_token,
    verify_token: cfg.verify_token,
    graph_version: cfg.graph_version ?? 'v20.0',
  };
}

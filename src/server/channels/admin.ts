import type { Env } from '../env';
import { audit } from '../lib/audit';
import { randomToken } from '../lib/crypto';
import { ids } from '../lib/ids';
import { partitionSecrets, sealJson } from '../lib/secrets';
import type { ChannelAdapter, ChannelKind, PublicChannel } from '../../types/channels';
import { PUBLIC_CHANNEL_KINDS } from '../../types/channels';
import { getMailbox, getPublicChannel } from './lookup';
import { tryGetAdapter } from './registry';
import { cleanOptional, cleanText, defaultChannelName, normalizeOrigins } from './utils';

// Owner/admin-facing channel CRUD. The chat/form session helpers live in
// `sessions.ts`; ingress + egress live in `ingress.ts` / `egress.ts`.

export interface CreatePublicChannelInput {
  kind: ChannelKind;
  mailboxId: string;
  name: string;
  enabled?: boolean;
  requireEmail?: boolean;
  allowedOrigins?: string[];
  welcomeMessage?: string | null;
  config?: Record<string, unknown>;
  slaFirstResponseMinutes?: number | null;
  slaResolutionMinutes?: number | null;
  defaultPriority?: string | null;
  defaultAssigneeUserId?: string | null;
}

export interface UpdatePublicChannelInput {
  name?: string;
  enabled?: boolean;
  requireEmail?: boolean;
  allowedOrigins?: string[];
  welcomeMessage?: string | null;
  config?: Record<string, unknown>;
  slaFirstResponseMinutes?: number | null;
  slaResolutionMinutes?: number | null;
  defaultPriority?: string | null;
  defaultAssigneeUserId?: string | null;
}

export async function createPublicChannel(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  input: CreatePublicChannelInput,
): Promise<PublicChannel> {
  if (input.kind === 'email') throw new Error('email_channel_not_supported_via_public_api');
  if (!PUBLIC_CHANNEL_KINDS.includes(input.kind)) throw new Error('unknown_channel_kind');
  const adapter = tryGetAdapter(input.kind);
  if (!adapter) throw new Error('channel_adapter_not_found');
  const config = adapter.validateConfig(input.config ?? {});
  const split = await splitConfigForPersist(env, workspaceId, adapter, config);
  const mailbox = await getMailbox(env, workspaceId, input.mailboxId);
  if (!mailbox) throw new Error('mailbox_not_found');
  const now = Date.now();
  const id = ids.publicChannel();
  const publicKey = `pub_${randomToken(12)}`;
  const signingSecret = `csk_${randomToken(24)}`;
  await env.DB.prepare(
    `INSERT INTO public_channel (
       id, workspace_id, mailbox_id, kind, name, public_key, enabled,
       require_email, allowed_origins_json, welcome_message, config_json,
       secrets_ciphertext, signing_secret, sla_first_response_minutes, sla_resolution_minutes,
       default_priority, default_assignee_user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      input.mailboxId,
      input.kind,
      cleanText(input.name, 80) || defaultChannelName(input.kind),
      publicKey,
      input.enabled === false ? 0 : 1,
      input.requireEmail === false ? 0 : 1,
      JSON.stringify(normalizeOrigins(input.allowedOrigins ?? [])),
      cleanOptional(input.welcomeMessage, 240),
      split.publicJson,
      split.secretsCiphertext,
      signingSecret,
      input.slaFirstResponseMinutes ?? null,
      input.slaResolutionMinutes ?? null,
      input.defaultPriority ?? null,
      input.defaultAssigneeUserId ?? null,
      now,
      now,
    )
    .run();
  const channel = await getPublicChannel(env, workspaceId, id);
  if (!channel) throw new Error('public_channel_create_failed');
  if (adapter.onActivate) {
    try {
      await adapter.onActivate(env, channel);
    } catch (err) {
      // Activation hook failed (e.g. Telegram setWebhook). Disable the
      // channel so the operator notices and can retry — silently creating
      // a broken channel would be worse.
      await env.DB.prepare(`UPDATE public_channel SET enabled = 0 WHERE id = ?`).bind(id).run();
      throw err instanceof Error
        ? new Error(`activation_failed:${err.message}`)
        : new Error('activation_failed:unknown');
    }
  }
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'public_channel.created',
    payload: { id, kind: input.kind, mailboxId: input.mailboxId },
  });
  return channel;
}

export async function updatePublicChannel(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  channelId: string,
  input: UpdatePublicChannelInput,
): Promise<PublicChannel | null> {
  const current = await getPublicChannel(env, workspaceId, channelId);
  if (!current) return null;
  const adapter = tryGetAdapter(current.kind);
  if (!adapter) throw new Error('channel_adapter_not_found');
  let nextPublicJson = current.config_json;
  let nextSecretsCiphertext = current.secrets_ciphertext;
  if (input.config !== undefined) {
    const validated = adapter.validateConfig(input.config);
    const split = await splitConfigForPersist(env, workspaceId, adapter, validated);
    nextPublicJson = split.publicJson;
    nextSecretsCiphertext = split.secretsCiphertext;
  }
  const next = mergeUpdate(current, input);
  await env.DB.prepare(
    `UPDATE public_channel
        SET name = ?, enabled = ?, require_email = ?, allowed_origins_json = ?,
            welcome_message = ?, config_json = ?, secrets_ciphertext = ?,
            sla_first_response_minutes = ?, sla_resolution_minutes = ?,
            default_priority = ?, default_assignee_user_id = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      next.name,
      next.enabled,
      next.requireEmail,
      next.allowedOrigins,
      next.welcomeMessage,
      nextPublicJson,
      nextSecretsCiphertext,
      next.slaFirstResponseMinutes,
      next.slaResolutionMinutes,
      next.defaultPriority,
      next.defaultAssigneeUserId,
      Date.now(),
      channelId,
      workspaceId,
    )
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'public_channel.updated',
    payload: { channelId, enabled: next.enabled === 1 },
  });
  return getPublicChannel(env, workspaceId, channelId);
}

async function splitConfigForPersist(
  env: Env,
  workspaceId: string,
  adapter: ChannelAdapter,
  config: Record<string, unknown>,
): Promise<{ publicJson: string; secretsCiphertext: string | null }> {
  const secretFields = adapter.secretFields ?? [];
  if (secretFields.length === 0) {
    return { publicJson: JSON.stringify(config), secretsCiphertext: null };
  }
  const { publicConfig, secrets } = partitionSecrets(config, secretFields);
  const secretsCiphertext = await sealJson(env, workspaceId, secrets);
  return { publicJson: JSON.stringify(publicConfig), secretsCiphertext };
}

function mergeUpdate(current: PublicChannel, input: UpdatePublicChannelInput) {
  return {
    name: input.name === undefined ? current.name : cleanText(input.name, 80) || current.name,
    enabled: input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    requireEmail:
      input.requireEmail === undefined ? current.require_email : input.requireEmail ? 1 : 0,
    allowedOrigins:
      input.allowedOrigins === undefined
        ? current.allowed_origins_json
        : JSON.stringify(normalizeOrigins(input.allowedOrigins)),
    welcomeMessage:
      input.welcomeMessage === undefined
        ? current.welcome_message
        : cleanOptional(input.welcomeMessage, 240),
    slaFirstResponseMinutes:
      input.slaFirstResponseMinutes === undefined
        ? current.sla_first_response_minutes
        : input.slaFirstResponseMinutes,
    slaResolutionMinutes:
      input.slaResolutionMinutes === undefined
        ? current.sla_resolution_minutes
        : input.slaResolutionMinutes,
    defaultPriority:
      input.defaultPriority === undefined ? current.default_priority : input.defaultPriority,
    defaultAssigneeUserId:
      input.defaultAssigneeUserId === undefined
        ? current.default_assignee_user_id
        : input.defaultAssigneeUserId,
  };
}

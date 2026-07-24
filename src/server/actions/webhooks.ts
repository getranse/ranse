import type { WebhookSubscription } from '../../interfaces/http';
import { hmacSign, randomToken } from '../../lib/crypto';
import { ids } from '../../lib/ids';
import type { Env } from '../env';
import type { NotificationEvent } from '../inbox/notifications/events';

export async function listWebhookSubscriptions(
  env: Env,
  workspaceId: string,
): Promise<WebhookSubscription[]> {
  const rows = await env.DB.prepare(
    `SELECT id, url, events_json, active, created_at FROM webhook_subscription
      WHERE workspace_id = ? ORDER BY created_at DESC`,
  )
    .bind(workspaceId)
    .all<{ id: string; url: string; events_json: string; active: number; created_at: number }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    url: r.url,
    events: JSON.parse(r.events_json || '[]'),
    active: r.active === 1,
    created_at: r.created_at,
  }));
}

/** Create a subscription; the signing secret is returned exactly once. */
export async function createWebhookSubscription(
  env: Env,
  args: { workspaceId: string; url: string; events: string[] },
): Promise<{ subscription: WebhookSubscription; secret: string }> {
  const secret = `whsec_${randomToken(24)}`;
  const subscription: WebhookSubscription = {
    id: ids.message(),
    url: args.url,
    events: args.events,
    active: true,
    created_at: Date.now(),
  };
  await env.DB.prepare(
    `INSERT INTO webhook_subscription (id, workspace_id, url, secret, events_json, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(
      subscription.id,
      args.workspaceId,
      subscription.url,
      secret,
      JSON.stringify(subscription.events),
      subscription.created_at,
    )
    .run();
  return { subscription, secret };
}

export async function deleteWebhookSubscription(
  env: Env,
  workspaceId: string,
  id: string,
): Promise<void> {
  await env.DB.prepare(`DELETE FROM webhook_subscription WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, id)
    .run();
}

/**
 * Fan a domain event out to matching active subscriptions. Each delivery is
 * enqueued with an HMAC-SHA256 signature over the JSON payload so receivers
 * can verify origin (x-ranse-signature header).
 */
export async function enqueueWebhookDeliveries(env: Env, event: NotificationEvent): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, url, secret, events_json FROM webhook_subscription
      WHERE workspace_id = ? AND active = 1`,
  )
    .bind(event.workspaceId)
    .all<{ id: string; url: string; secret: string; events_json: string }>();

  const matching = (rows.results ?? []).filter((r) => {
    try {
      return (JSON.parse(r.events_json || '[]') as string[]).includes(event.name);
    } catch {
      return false;
    }
  });
  if (matching.length === 0) return;

  const body = JSON.stringify(event);
  await Promise.allSettled(
    matching.map(async (sub) =>
      env.WEBHOOKS.send({
        type: 'webhook.deliver',
        url: sub.url,
        signature: await hmacSign(sub.secret, body),
        payload: event,
      }),
    ),
  );
}

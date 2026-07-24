import type { ChannelRow } from '../../../interfaces/notifications';
import { enqueueWebhookDeliveries } from '../../actions/webhooks';
import type { Env } from '../../env';
import type { EventName, EventPayload, NotificationEvent } from './events';

// Single emit point. Loads enabled channels for the workspace, filters
// to those subscribed to this event, and enqueues one delivery message
// per match. Delivery itself runs in the queue consumer so the caller
// (usually the email ingest path) returns fast and is unaffected by
// channel failures.
export async function emitEvent<E extends EventName>(
  env: Env,
  workspaceId: string,
  name: E,
  payload: EventPayload<E>,
): Promise<void> {
  const event: NotificationEvent = {
    name,
    payload,
    workspaceId,
    emittedAt: Date.now(),
  } as NotificationEvent;

  // Third-party webhook subscriptions get the same event stream as the
  // built-in channels; failures are logged, never propagated to the caller.
  await enqueueWebhookDeliveries(env, event).catch((err) =>
    console.warn('webhook fan-out failed', err),
  );

  const rows = await env.DB.prepare(
    `SELECT id, kind, target, events FROM notification_channel
      WHERE workspace_id = ? AND enabled = 1`,
  )
    .bind(workspaceId)
    .all<ChannelRow>();

  const subscribers = (rows.results ?? []).filter((r) => {
    try {
      const events = JSON.parse(r.events);
      return Array.isArray(events) && events.includes(name);
    } catch {
      return false;
    }
  });

  if (subscribers.length === 0) return;

  // Send all in parallel; if the queue is briefly unavailable we log and
  // move on rather than fail the originating request.
  await Promise.allSettled(
    subscribers.map((sub) =>
      env.WEBHOOKS.send({
        type: 'notification.deliver',
        channelId: sub.id,
        kind: sub.kind,
        target: sub.target,
        event,
      }),
    ),
  );
}

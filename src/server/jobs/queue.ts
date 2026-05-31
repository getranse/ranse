import type { WebhookDeliveryMessage } from '../../interfaces/jobs';
import type { MessageBatch } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { getHandler } from '../inbox/notifications/channels';

export async function handleQueueBatch(batch: MessageBatch, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await handleQueueMessage(msg.body as { type: string; [k: string]: any }, env);
      msg.ack();
    } catch (err) {
      console.error('queue error', err);
      msg.retry({ delaySeconds: 30 });
    }
  }
}

async function handleQueueMessage(body: { type: string; [k: string]: any }, env: Env): Promise<void> {
  switch (body.type) {
    case 'webhook.deliver':
      await deliverWebhook(body as unknown as WebhookDeliveryMessage);
      return;
    case 'notification.deliver': {
      const handler = getHandler(body.kind);
      if (!handler) throw new Error(`unknown channel kind: ${body.kind}`);
      await handler.deliver(env, body.target, body.event);
      return;
    }
    default:
      console.warn('unknown queue message', body.type);
  }
}

async function deliverWebhook(body: WebhookDeliveryMessage): Promise<void> {
  const res = await fetch(body.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ranse-signature': body.signature },
    body: JSON.stringify(body.payload),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

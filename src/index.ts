import type {
  ExecutionContext,
  ForwardableEmailMessage,
  MessageBatch,
  ScheduledController,
} from '@cloudflare/workers-types';
import type { Env } from './env';
import { handleEmailMessage } from './email/handler';
import { app } from './http/app';
import { handleScheduled } from './jobs/scheduled';
import { handleQueueBatch } from './queues/handler';

export { WorkspaceSupervisorAgent } from './agents/WorkspaceSupervisorAgent';
export { MailboxAgent } from './agents/MailboxAgent';
export { UserSecretsStore } from './agents/UserSecretsStore';

export default {
  fetch: app.fetch,

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmailMessage(message, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(controller, env, ctx);
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};

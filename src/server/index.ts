import type {
  ExecutionContext,
  ForwardableEmailMessage,
  MessageBatch,
  ScheduledController,
} from '@cloudflare/workers-types';
import type { Env } from './env';
import { handleEmailMessage } from './inbox/email/handler';
import { app } from './http/app';
import { handleScheduled } from './jobs/scheduled';
import { handleQueueBatch } from './jobs/queue';

export { WorkspaceSupervisorAgent } from './inbox/agents/WorkspaceSupervisorAgent';
export { MailboxAgent } from './inbox/agents/MailboxAgent';
export { UserSecretsStore } from './inbox/agents/UserSecretsStore';
export { ProcedureRunnerAgent } from './inbox/agents/ProcedureRunnerAgent';

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

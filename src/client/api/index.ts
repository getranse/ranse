import { approvalApi } from './approvals';
import { authApi } from './auth';
import { billingApi } from './billing';
import { channelApi } from './channels';
import { evalApi } from './evals';
import { insightApi } from './insights';
import { knowledgeApi } from './knowledge';
import { mcpApi } from './mcp';
import { memoryApi } from './memory';
import { notificationApi } from './notifications';
import { onboardingApi } from './onboarding';
import { procedureApi } from './procedures';
import { profileApi } from './profile';
import { llmApi } from './llm';
import { setupApi } from './setup';
import { ticketApi } from './tickets';
import { workspaceApi } from './workspaces';

export { ApiRequestError, api } from './core';
export type * from '../../types/client';

/**
 * Flat facade over the per-domain API modules. Call sites use `API.<method>()`;
 * each method lives in its domain file under `client/api/` (see ./tickets, ./knowledge, ...).
 */
export const API = {
  ...setupApi,
  ...authApi,
  ...workspaceApi,
  ...ticketApi,
  ...profileApi,
  ...notificationApi,
  ...channelApi,
  ...approvalApi,
  ...knowledgeApi,
  ...procedureApi,
  ...mcpApi,
  ...evalApi,
  ...insightApi,
  ...onboardingApi,
  ...billingApi,
  ...memoryApi,
  ...llmApi,
};

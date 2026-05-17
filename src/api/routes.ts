import { Hono } from 'hono';
import { registerApprovalRoutes } from './approvals';
import { installApiAuth, type Ctx } from './context';
import { registerKnowledgeRoutes } from './knowledge';
import { registerNotificationRoutes } from './notifications';
import { registerSettingsRoutes } from './settings';
import { registerTicketRoutes } from './tickets';
import { registerWorkspaceRoutes } from './workspaces';

export const apiApp = new Hono<Ctx>();

installApiAuth(apiApp);
registerTicketRoutes(apiApp);
registerSettingsRoutes(apiApp);
registerNotificationRoutes(apiApp);
registerApprovalRoutes(apiApp);
registerKnowledgeRoutes(apiApp);
registerWorkspaceRoutes(apiApp);

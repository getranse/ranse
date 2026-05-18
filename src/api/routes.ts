import { Hono } from 'hono';
import { registerApprovalRoutes } from './approvals';
import { installApiAuth, type Ctx } from './context';
import { registerEvalRoutes } from './evals';
import { registerInsightRoutes } from './insights';
import { registerKnowledgeRoutes } from './knowledge';
import { registerMcpRoutes } from './mcp';
import { registerNotificationRoutes } from './notifications';
import { registerProcedureRoutes } from './procedures';
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
registerProcedureRoutes(apiApp);
registerMcpRoutes(apiApp);
registerEvalRoutes(apiApp);
registerInsightRoutes(apiApp);
registerWorkspaceRoutes(apiApp);

import type { Hono } from 'hono';
import { z } from 'zod';
import { FIRST_PARTY_MCP_TEMPLATES } from '../mcp/first-party/catalog';
import { listRemoteMcpTools } from '../mcp/client';
import { getMcpAuthSecret, setMcpAuthSecret, deleteMcpAuthSecret } from '../mcp/secrets';
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  listMcpTools,
  listTicketMcpToolCalls,
  updateMcpServer,
  updateMcpServerDiscoveryState,
  upsertDiscoveredMcpTools,
  upsertMcpToolGuardrail,
} from '../mcp/storage';
import { apiError } from '../lib/errors';
import { CAN_WORK_TICKETS, type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

const authTypeSchema = z.enum(['none', 'bearer', 'header']);

const createServerSchema = z.object({
  name: z.string().min(1).max(80),
  endpoint_url: z.string().min(1).max(500),
  auth_type: authTypeSchema.default('none'),
  auth_header_name: z.string().max(80).nullable().optional(),
  auth_secret: z.string().max(5000).optional(),
  enabled: z.boolean().optional(),
});

const updateServerSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  endpoint_url: z.string().min(1).max(500).optional(),
  auth_type: authTypeSchema.optional(),
  auth_header_name: z.string().max(80).nullable().optional(),
  auth_secret: z.string().max(5000).optional(),
  enabled: z.boolean().optional(),
});

const guardrailSchema = z.object({
  tool_name: z.string().min(1).max(160),
  enabled: z.boolean().optional(),
  requires_approval: z.boolean().nullable().optional(),
  max_calls_per_ticket: z.number().int().min(1).max(500).nullable().optional(),
  max_calls_per_hour: z.number().int().min(1).max(5000).nullable().optional(),
  dollar_limit_cents: z.number().int().min(1).max(100_000_000).nullable().optional(),
  allowed_customer_segments: z.array(z.string().min(1).max(80)).max(50).optional(),
});

export function registerMcpRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/mcp/catalog', async (c) => c.json({ templates: FIRST_PARTY_MCP_TEMPLATES }));

  apiApp.get('/mcp/servers', async (c) => {
    const s = c.get('session');
    return c.json({ servers: await listMcpServers(c.env, s.workspaceId) });
  });

  apiApp.post('/mcp/servers', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = createServerSchema.parse(await c.req.json());
    if (body.auth_type !== 'none' && !body.auth_secret) {
      return apiError(c, 'validation_error', 'auth_secret is required for authenticated MCP servers.');
    }
    try {
      const server = await createMcpServer(c.env, {
        workspaceId: s.workspaceId,
        actorUserId: s.userId,
        name: body.name,
        endpointUrl: body.endpoint_url,
        authType: body.auth_type,
        authHeaderName: body.auth_header_name,
        enabled: body.enabled,
      });
      await setMcpAuthSecret(c.env, s.workspaceId, server.secret_ref, body.auth_secret);
      return c.json({ server });
    } catch (err) {
      return mapMcpError(c, err);
    }
  });

  apiApp.patch('/mcp/servers/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = updateServerSchema.parse(await c.req.json());
    const before = await getMcpServer(c.env, s.workspaceId, c.req.param('id'));
    if (!before) return apiError(c, 'not_found', 'That MCP server does not exist.');
    try {
      const server = await updateMcpServer(c.env, s.workspaceId, c.req.param('id'), {
        actorUserId: s.userId,
        name: body.name,
        endpointUrl: body.endpoint_url,
        authType: body.auth_type,
        authHeaderName: body.auth_header_name,
        enabled: body.enabled,
        clearLastError: true,
      });
      if (!server) return apiError(c, 'not_found', 'That MCP server does not exist.');
      await setMcpAuthSecret(c.env, s.workspaceId, server.secret_ref, body.auth_secret);
      if (server.auth_type === 'none') await deleteMcpAuthSecret(c.env, s.workspaceId, before.secret_ref);
      return c.json({ server });
    } catch (err) {
      return mapMcpError(c, err);
    }
  });

  apiApp.delete('/mcp/servers/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const server = await getMcpServer(c.env, s.workspaceId, c.req.param('id'));
    if (!server) return apiError(c, 'not_found', 'That MCP server does not exist.');
    await deleteMcpServer(c.env, s.workspaceId, server.id, s.userId);
    await deleteMcpAuthSecret(c.env, s.workspaceId, server.secret_ref);
    return c.json({ ok: true });
  });

  apiApp.post('/mcp/servers/:id/discover', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const server = await getMcpServer(c.env, s.workspaceId, c.req.param('id'));
    if (!server) return apiError(c, 'not_found', 'That MCP server does not exist.');
    try {
      const tools = await listRemoteMcpTools(server, {
        authSecret: await getMcpAuthSecret(c.env, s.workspaceId, server),
      });
      const stored = await upsertDiscoveredMcpTools(c.env, s.workspaceId, server.id, tools);
      return c.json({ ok: true, tools: stored });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'mcp_discovery_failed';
      await updateMcpServerDiscoveryState(c.env, s.workspaceId, server.id, { ok: false, error });
      return apiError(c, 'bad_gateway', error, 502);
    }
  });

  apiApp.get('/mcp/tools', async (c) => {
    const s = c.get('session');
    return c.json({ tools: await listMcpTools(c.env, s.workspaceId, c.req.query('server_id')) });
  });

  apiApp.post(
    '/mcp/servers/:id/guardrails',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const server = await getMcpServer(c.env, s.workspaceId, c.req.param('id'));
      if (!server) return apiError(c, 'not_found', 'That MCP server does not exist.');
      const body = guardrailSchema.parse(await c.req.json());
      const guardrail = await upsertMcpToolGuardrail(c.env, s.workspaceId, server.id, body.tool_name, {
        actorUserId: s.userId,
        enabled: body.enabled,
        requiresApproval: body.requires_approval,
        maxCallsPerTicket: body.max_calls_per_ticket,
        maxCallsPerHour: body.max_calls_per_hour,
        dollarLimitCents: body.dollar_limit_cents,
        allowedCustomerSegments: body.allowed_customer_segments,
      });
      return c.json({ guardrail });
    },
  );

  apiApp.get('/mcp/tool-calls', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const ticketId = c.req.query('ticket_id');
    if (!ticketId) return apiError(c, 'validation_error', 'ticket_id is required.');
    return c.json({ toolCalls: await listTicketMcpToolCalls(c.env, s.workspaceId, ticketId) });
  });
}

function mapMcpError(c: any, err: unknown) {
  const message = err instanceof Error ? err.message : 'mcp_error';
  if (
    [
      'invalid_url',
      'unsupported_url_scheme',
      'https_required',
      'url_credentials_not_allowed',
      'private_url_not_allowed',
      'invalid_auth_header_name',
      'forbidden_auth_header_name',
      'auth_header_name_required',
      'invalid_mcp_server_name',
    ].includes(message)
  ) {
    return apiError(c, 'validation_error', message);
  }
  if (String(message).includes('UNIQUE')) return apiError(c, 'conflict', 'MCP server name already exists.', 409);
  throw err;
}

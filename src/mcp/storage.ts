import type { Env } from '../env';
import { audit } from '../lib/audit';
import { ids } from '../lib/ids';
import { validatePublicHttpUrl } from '../lib/url-security';
import type {
  McpAuthType,
  McpDiscoveredTool,
  McpServer,
  McpServerListItem,
  McpTool,
  McpToolCall,
  McpToolCallStatus,
  McpToolGuardrail,
} from '../types/mcp';

export const MCP_SECRET_PREFIX = 'mcp:';

const FORBIDDEN_AUTH_HEADERS = new Set([
  'accept',
  'authorization',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'mcp-protocol-version',
  'mcp-session-id',
  'origin',
  'referer',
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
]);

export function normalizeMcpServerName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function validateMcpEndpoint(input: string): string {
  return validatePublicHttpUrl(input, { httpsOnly: true }).toString();
}

export function validateMcpAuthHeaderName(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,80}$/.test(normalized)) throw new Error('invalid_auth_header_name');
  if (FORBIDDEN_AUTH_HEADERS.has(normalized)) throw new Error('forbidden_auth_header_name');
  return normalized;
}

export async function listMcpServers(
  env: Env,
  workspaceId: string,
): Promise<McpServerListItem[]> {
  const rows = await env.DB.prepare(
    `SELECT s.*, COUNT(t.id) AS tool_count
       FROM mcp_server s
       LEFT JOIN mcp_tool t ON t.server_id = s.id
      WHERE s.workspace_id = ?
      GROUP BY s.id
      ORDER BY s.updated_at DESC`,
  )
    .bind(workspaceId)
    .all<McpServerListItem>();
  return rows.results ?? [];
}

export async function createMcpServer(
  env: Env,
  input: {
    workspaceId: string;
    actorUserId?: string | null;
    name: string;
    endpointUrl: string;
    authType?: McpAuthType;
    authHeaderName?: string | null;
    enabled?: boolean;
  },
): Promise<McpServer> {
  const now = Date.now();
  const id = ids.mcpServer();
  const authType = input.authType ?? 'none';
  const headerName = authType === 'header' ? validateMcpAuthHeaderName(input.authHeaderName) : null;
  if (authType === 'header' && !headerName) throw new Error('auth_header_name_required');
  const server: McpServer = {
    id,
    workspace_id: input.workspaceId,
    name: normalizeMcpServerName(input.name),
    endpoint_url: validateMcpEndpoint(input.endpointUrl),
    auth_type: authType,
    auth_header_name: headerName,
    secret_ref: authType === 'none' ? null : `${MCP_SECRET_PREFIX}${id}`,
    enabled: input.enabled === false ? 0 : 1,
    last_discovered_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
  if (!server.name) throw new Error('invalid_mcp_server_name');

  await env.DB.prepare(
    `INSERT INTO mcp_server (
       id, workspace_id, name, endpoint_url, auth_type, auth_header_name, secret_ref,
       enabled, last_discovered_at, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      server.id,
      server.workspace_id,
      server.name,
      server.endpoint_url,
      server.auth_type,
      server.auth_header_name,
      server.secret_ref,
      server.enabled,
      server.last_discovered_at,
      server.last_error,
      server.created_at,
      server.updated_at,
    )
    .run();
  await audit(env, {
    workspaceId: input.workspaceId,
    actorType: input.actorUserId ? 'user' : 'system',
    actorId: input.actorUserId ?? undefined,
    action: 'mcp.server_created',
    payload: { serverId: server.id, name: server.name, authType: server.auth_type },
  });
  return server;
}

export async function updateMcpServer(
  env: Env,
  workspaceId: string,
  serverId: string,
  patch: {
    actorUserId?: string | null;
    name?: string;
    endpointUrl?: string;
    authType?: McpAuthType;
    authHeaderName?: string | null;
    enabled?: boolean;
    clearLastError?: boolean;
  },
): Promise<McpServer | null> {
  const existing = await getMcpServer(env, workspaceId, serverId);
  if (!existing) return null;
  const authType = patch.authType ?? existing.auth_type;
  const headerName =
    authType === 'header'
      ? validateMcpAuthHeaderName(patch.authHeaderName ?? existing.auth_header_name)
      : null;
  if (authType === 'header' && !headerName) throw new Error('auth_header_name_required');
  const next = {
    name: patch.name ? normalizeMcpServerName(patch.name) : existing.name,
    endpointUrl: patch.endpointUrl ? validateMcpEndpoint(patch.endpointUrl) : existing.endpoint_url,
    authType,
    authHeaderName: headerName,
    secretRef: authType === 'none' ? null : (existing.secret_ref ?? `${MCP_SECRET_PREFIX}${existing.id}`),
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
    lastError: patch.clearLastError ? null : existing.last_error,
  };
  if (!next.name) throw new Error('invalid_mcp_server_name');

  await env.DB.prepare(
    `UPDATE mcp_server
        SET name = ?, endpoint_url = ?, auth_type = ?, auth_header_name = ?, secret_ref = ?,
            enabled = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      next.name,
      next.endpointUrl,
      next.authType,
      next.authHeaderName,
      next.secretRef,
      next.enabled,
      next.lastError,
      Date.now(),
      serverId,
      workspaceId,
    )
    .run();
  await audit(env, {
    workspaceId,
    actorType: patch.actorUserId ? 'user' : 'system',
    actorId: patch.actorUserId ?? undefined,
    action: 'mcp.server_updated',
    payload: { serverId, name: next.name, authType: next.authType, enabled: next.enabled === 1 },
  });
  return getMcpServer(env, workspaceId, serverId);
}

export async function deleteMcpServer(
  env: Env,
  workspaceId: string,
  serverId: string,
  actorUserId?: string | null,
): Promise<boolean> {
  const existing = await getMcpServer(env, workspaceId, serverId);
  if (!existing) return false;
  await env.DB.prepare(`DELETE FROM mcp_server WHERE id = ? AND workspace_id = ?`)
    .bind(serverId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    actorType: actorUserId ? 'user' : 'system',
    actorId: actorUserId ?? undefined,
    action: 'mcp.server_deleted',
    payload: { serverId, name: existing.name },
  });
  return true;
}

export async function getMcpServer(
  env: Env,
  workspaceId: string,
  serverId: string,
): Promise<McpServer | null> {
  return env.DB.prepare(`SELECT * FROM mcp_server WHERE id = ? AND workspace_id = ?`)
    .bind(serverId, workspaceId)
    .first<McpServer>();
}

export async function updateMcpServerDiscoveryState(
  env: Env,
  workspaceId: string,
  serverId: string,
  patch: { ok: boolean; error?: string | null; discoveredAt?: number },
) {
  await env.DB.prepare(
    `UPDATE mcp_server
        SET last_discovered_at = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      patch.ok ? (patch.discoveredAt ?? Date.now()) : null,
      patch.ok ? null : (patch.error ?? 'mcp_discovery_failed'),
      Date.now(),
      serverId,
      workspaceId,
    )
    .run();
}

export async function listMcpTools(
  env: Env,
  workspaceId: string,
  serverId?: string,
): Promise<McpTool[]> {
  const where = serverId ? 'WHERE t.workspace_id = ? AND t.server_id = ?' : 'WHERE t.workspace_id = ?';
  const rows = await env.DB.prepare(
    `SELECT t.*, s.name AS server_name, s.enabled AS server_enabled,
            g.enabled AS guardrail_enabled,
            g.requires_approval AS guardrail_requires_approval,
            g.max_calls_per_ticket AS guardrail_max_calls_per_ticket,
            g.max_calls_per_hour AS guardrail_max_calls_per_hour,
            g.dollar_limit_cents AS guardrail_dollar_limit_cents
       FROM mcp_tool t
       JOIN mcp_server s ON s.id = t.server_id
       LEFT JOIN mcp_tool_guardrail g
         ON g.workspace_id = t.workspace_id AND g.server_id = t.server_id AND g.tool_name = t.name
       ${where}
      ORDER BY s.name ASC, t.name ASC`,
  )
    .bind(...(serverId ? [workspaceId, serverId] : [workspaceId]))
    .all<McpTool>();
  return rows.results ?? [];
}

export async function getMcpTool(
  env: Env,
  workspaceId: string,
  serverId: string,
  toolName: string,
): Promise<McpTool | null> {
  return env.DB.prepare(
    `SELECT t.*, s.name AS server_name, s.enabled AS server_enabled
       FROM mcp_tool t
       JOIN mcp_server s ON s.id = t.server_id
      WHERE t.workspace_id = ? AND t.server_id = ? AND t.name = ?
      LIMIT 1`,
  )
    .bind(workspaceId, serverId, toolName)
    .first<McpTool>();
}

export async function upsertDiscoveredMcpTools(
  env: Env,
  workspaceId: string,
  serverId: string,
  tools: McpDiscoveredTool[],
): Promise<McpTool[]> {
  const now = Date.now();
  const discoveredNames: string[] = [];
  for (const tool of tools) {
    if (!tool.name || typeof tool.name !== 'string') continue;
    discoveredNames.push(tool.name);
    const annotations = asObject(tool.annotations);
    const readOnlyHint = typeof annotations.readOnlyHint === 'boolean' ? annotations.readOnlyHint : null;
    const destructiveHint =
      typeof annotations.destructiveHint === 'boolean' ? annotations.destructiveHint : null;
    await env.DB.prepare(
      `INSERT INTO mcp_tool (
         id, workspace_id, server_id, name, title, description, input_schema_json,
         annotations_json, read_only_hint, destructive_hint, discovered_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, name) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         input_schema_json = excluded.input_schema_json,
         annotations_json = excluded.annotations_json,
         read_only_hint = excluded.read_only_hint,
         destructive_hint = excluded.destructive_hint,
         discovered_at = excluded.discovered_at`,
    )
      .bind(
        ids.mcpTool(),
        workspaceId,
        serverId,
        tool.name,
        typeof tool.title === 'string' ? tool.title : (typeof annotations.title === 'string' ? annotations.title : null),
        typeof tool.description === 'string' ? tool.description : null,
        JSON.stringify(tool.inputSchema ?? {}),
        JSON.stringify(annotations),
        readOnlyHint === null ? null : readOnlyHint ? 1 : 0,
        destructiveHint === null ? null : destructiveHint ? 1 : 0,
        now,
      )
      .run();
  }
  await deleteStaleMcpTools(env, workspaceId, serverId, discoveredNames);
  await updateMcpServerDiscoveryState(env, workspaceId, serverId, { ok: true, discoveredAt: now });
  return listMcpTools(env, workspaceId, serverId);
}

async function deleteStaleMcpTools(
  env: Env,
  workspaceId: string,
  serverId: string,
  discoveredNames: string[],
): Promise<void> {
  if (discoveredNames.length === 0) {
    await env.DB.prepare(`DELETE FROM mcp_tool WHERE workspace_id = ? AND server_id = ?`)
      .bind(workspaceId, serverId)
      .run();
    return;
  }
  const placeholders = discoveredNames.map(() => '?').join(',');
  await env.DB.prepare(
    `DELETE FROM mcp_tool
      WHERE workspace_id = ? AND server_id = ? AND name NOT IN (${placeholders})`,
  )
    .bind(workspaceId, serverId, ...discoveredNames)
    .run();
}

export async function getMcpToolGuardrail(
  env: Env,
  workspaceId: string,
  serverId: string,
  toolName: string,
): Promise<McpToolGuardrail | null> {
  return env.DB.prepare(
    `SELECT * FROM mcp_tool_guardrail
      WHERE workspace_id = ? AND server_id = ? AND tool_name = ?`,
  )
    .bind(workspaceId, serverId, toolName)
    .first<McpToolGuardrail>();
}

export async function upsertMcpToolGuardrail(
  env: Env,
  workspaceId: string,
  serverId: string,
  toolName: string,
  patch: {
    actorUserId?: string | null;
    enabled?: boolean;
    requiresApproval?: boolean | null;
    maxCallsPerTicket?: number | null;
    maxCallsPerHour?: number | null;
    dollarLimitCents?: number | null;
    allowedCustomerSegments?: string[];
  },
): Promise<McpToolGuardrail> {
  const existing = await getMcpToolGuardrail(env, workspaceId, serverId, toolName);
  const enabled = patch.enabled === undefined ? (existing?.enabled ?? 1) : patch.enabled ? 1 : 0;
  const requiresApproval =
    patch.requiresApproval === undefined
      ? (existing?.requires_approval ?? null)
      : patch.requiresApproval === null
        ? null
        : patch.requiresApproval
          ? 1
          : 0;
  const segments =
    patch.allowedCustomerSegments === undefined
      ? existing?.allowed_customer_segments_json ?? '[]'
      : JSON.stringify(patch.allowedCustomerSegments.slice(0, 50));
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO mcp_tool_guardrail (
       workspace_id, server_id, tool_name, enabled, requires_approval,
       max_calls_per_ticket, max_calls_per_hour, dollar_limit_cents,
       allowed_customer_segments_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, server_id, tool_name) DO UPDATE SET
       enabled = excluded.enabled,
       requires_approval = excluded.requires_approval,
       max_calls_per_ticket = excluded.max_calls_per_ticket,
       max_calls_per_hour = excluded.max_calls_per_hour,
       dollar_limit_cents = excluded.dollar_limit_cents,
       allowed_customer_segments_json = excluded.allowed_customer_segments_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      workspaceId,
      serverId,
      toolName,
      enabled,
      requiresApproval,
      patch.maxCallsPerTicket === undefined
        ? (existing?.max_calls_per_ticket ?? null)
        : patch.maxCallsPerTicket,
      patch.maxCallsPerHour === undefined
        ? (existing?.max_calls_per_hour ?? null)
        : patch.maxCallsPerHour,
      patch.dollarLimitCents === undefined
        ? (existing?.dollar_limit_cents ?? null)
        : patch.dollarLimitCents,
      segments,
      now,
    )
    .run();
  await audit(env, {
    workspaceId,
    actorType: patch.actorUserId ? 'user' : 'system',
    actorId: patch.actorUserId ?? undefined,
    action: 'mcp.guardrail_updated',
    payload: { serverId, toolName },
  });
  return (await getMcpToolGuardrail(env, workspaceId, serverId, toolName))!;
}

export async function resolveMcpToolReference(
  env: Env,
  workspaceId: string,
  toolRef: string,
): Promise<{ server: McpServer; tool: McpTool }> {
  const dot = toolRef.indexOf('.');
  if (dot > 0) {
    const serverRef = toolRef.slice(0, dot);
    const toolName = toolRef.slice(dot + 1);
    const row = await env.DB.prepare(
      `SELECT t.*, s.id AS s_id, s.workspace_id AS s_workspace_id, s.name AS s_name,
              s.endpoint_url AS s_endpoint_url, s.auth_type AS s_auth_type,
              s.auth_header_name AS s_auth_header_name, s.secret_ref AS s_secret_ref,
              s.enabled AS s_enabled, s.last_discovered_at AS s_last_discovered_at,
              s.last_error AS s_last_error, s.created_at AS s_created_at, s.updated_at AS s_updated_at
         FROM mcp_tool t
         JOIN mcp_server s ON s.id = t.server_id
        WHERE t.workspace_id = ? AND (s.id = ? OR s.name = ?) AND t.name = ?
        LIMIT 1`,
    )
      .bind(workspaceId, serverRef, normalizeMcpServerName(serverRef), toolName)
      .first<any>();
    if (!row) throw new Error('mcp_tool_not_found');
    return rowToResolvedTool(row);
  }

  const rows = await env.DB.prepare(
    `SELECT t.*, s.id AS s_id, s.workspace_id AS s_workspace_id, s.name AS s_name,
            s.endpoint_url AS s_endpoint_url, s.auth_type AS s_auth_type,
            s.auth_header_name AS s_auth_header_name, s.secret_ref AS s_secret_ref,
            s.enabled AS s_enabled, s.last_discovered_at AS s_last_discovered_at,
            s.last_error AS s_last_error, s.created_at AS s_created_at, s.updated_at AS s_updated_at
       FROM mcp_tool t
       JOIN mcp_server s ON s.id = t.server_id
      WHERE t.workspace_id = ? AND t.name = ? AND s.enabled = 1
      LIMIT 2`,
  )
    .bind(workspaceId, toolRef)
    .all<any>();
  const results = rows.results ?? [];
  if (results.length === 0) throw new Error('mcp_tool_not_found');
  if (results.length > 1) throw new Error('mcp_tool_ambiguous');
  return rowToResolvedTool(results[0]);
}

export async function createMcpToolCall(
  env: Env,
  input: {
    workspaceId: string;
    serverId: string;
    toolName: string;
    ticketId: string;
    procedureRunId?: string | null;
    procedureStepId?: string | null;
    procedureStepIndex?: number | null;
    status: McpToolCallStatus;
    args: unknown;
    approvalRequestId?: string | null;
  },
): Promise<McpToolCall> {
  const now = Date.now();
  const call: McpToolCall = {
    id: ids.mcpToolCall(),
    workspace_id: input.workspaceId,
    server_id: input.serverId,
    tool_name: input.toolName,
    ticket_id: input.ticketId,
    procedure_run_id: input.procedureRunId ?? null,
    procedure_step_id: input.procedureStepId ?? null,
    procedure_step_index: input.procedureStepIndex ?? null,
    status: input.status,
    args_json: JSON.stringify(input.args ?? {}),
    result_json: '{}',
    error: null,
    approval_request_id: input.approvalRequestId ?? null,
    idempotency_key: ids.mcpToolCall(),
    started_at: input.status === 'running' ? now : null,
    completed_at: ['completed', 'failed', 'blocked'].includes(input.status) ? now : null,
    created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO mcp_tool_call (
       id, workspace_id, server_id, tool_name, ticket_id, procedure_run_id,
       procedure_step_id, procedure_step_index, status, args_json, result_json,
       error, approval_request_id, idempotency_key, started_at, completed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      call.id,
      call.workspace_id,
      call.server_id,
      call.tool_name,
      call.ticket_id,
      call.procedure_run_id,
      call.procedure_step_id,
      call.procedure_step_index,
      call.status,
      call.args_json,
      call.result_json,
      call.error,
      call.approval_request_id,
      call.idempotency_key,
      call.started_at,
      call.completed_at,
      call.created_at,
    )
    .run();
  return call;
}

export async function updateMcpToolCall(
  env: Env,
  workspaceId: string,
  callId: string,
  patch: {
    status: McpToolCallStatus;
    result?: unknown;
    error?: string | null;
    approvalRequestId?: string | null;
    startedAt?: number | null;
    completedAt?: number | null;
  },
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE mcp_tool_call
        SET status = ?,
            result_json = COALESCE(?, result_json),
            error = ?,
            approval_request_id = COALESCE(?, approval_request_id),
            started_at = COALESCE(started_at, ?),
            completed_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      patch.status,
      patch.result === undefined ? null : JSON.stringify(patch.result),
      patch.error ?? null,
      patch.approvalRequestId ?? null,
      patch.startedAt ?? (patch.status === 'running' ? now : null),
      patch.completedAt ??
        (['completed', 'failed', 'blocked'].includes(patch.status) ? now : null),
      callId,
      workspaceId,
    )
    .run();
}

export async function getMcpToolCall(
  env: Env,
  workspaceId: string,
  callId: string,
): Promise<McpToolCall | null> {
  return env.DB.prepare(`SELECT * FROM mcp_tool_call WHERE id = ? AND workspace_id = ?`)
    .bind(callId, workspaceId)
    .first<McpToolCall>();
}

export async function getMcpToolCallForProcedureStep(
  env: Env,
  workspaceId: string,
  procedureRunId: string,
  procedureStepIndex: number,
): Promise<McpToolCall | null> {
  return env.DB.prepare(
    `SELECT * FROM mcp_tool_call
      WHERE workspace_id = ? AND procedure_run_id = ? AND procedure_step_index = ?
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(workspaceId, procedureRunId, procedureStepIndex)
    .first<McpToolCall>();
}

export async function listTicketMcpToolCalls(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<McpToolCall[]> {
  const rows = await env.DB.prepare(
    `SELECT c.*, s.name AS server_name
       FROM mcp_tool_call c
       JOIN mcp_server s ON s.id = c.server_id
      WHERE c.workspace_id = ? AND c.ticket_id = ?
      ORDER BY c.created_at DESC
      LIMIT 50`,
  )
    .bind(workspaceId, ticketId)
    .all<McpToolCall>();
  return rows.results ?? [];
}

export async function countMcpToolCallsForTicket(
  env: Env,
  workspaceId: string,
  serverId: string,
  toolName: string,
  ticketId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mcp_tool_call
      WHERE workspace_id = ? AND server_id = ? AND tool_name = ? AND ticket_id = ?`,
  )
    .bind(workspaceId, serverId, toolName, ticketId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countMcpToolCallsSince(
  env: Env,
  workspaceId: string,
  serverId: string,
  toolName: string,
  since: number,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mcp_tool_call
      WHERE workspace_id = ? AND server_id = ? AND tool_name = ? AND created_at >= ?`,
  )
    .bind(workspaceId, serverId, toolName, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function rowToResolvedTool(row: any): { server: McpServer; tool: McpTool } {
  return {
    server: {
      id: row.s_id,
      workspace_id: row.s_workspace_id,
      name: row.s_name,
      endpoint_url: row.s_endpoint_url,
      auth_type: row.s_auth_type,
      auth_header_name: row.s_auth_header_name,
      secret_ref: row.s_secret_ref,
      enabled: row.s_enabled,
      last_discovered_at: row.s_last_discovered_at,
      last_error: row.s_last_error,
      created_at: row.s_created_at,
      updated_at: row.s_updated_at,
    },
    tool: {
      id: row.id,
      workspace_id: row.workspace_id,
      server_id: row.server_id,
      name: row.name,
      title: row.title,
      description: row.description,
      input_schema_json: row.input_schema_json,
      annotations_json: row.annotations_json,
      read_only_hint: row.read_only_hint,
      destructive_hint: row.destructive_hint,
      discovered_at: row.discovered_at,
      server_name: row.s_name,
      server_enabled: row.s_enabled,
    },
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

import type { JsonRpcSuccess, JsonRpcFailure, McpClientOptions, McpToolCallResult, McpSession } from '../../../interfaces/mcp';
export type { McpClientOptions, McpToolCallResult };
import type { McpDiscoveredTool, McpServer } from '../../../types/shared/mcp';

import { DEFAULT_MCP_HTTP_TIMEOUT_MS, MAX_MCP_RESPONSE_BYTES } from '../../../config/mcp';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION, '2025-06-18'] as const;

type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcFailure;

export async function listRemoteMcpTools(
  server: McpServer,
  options: McpClientOptions = {},
): Promise<McpDiscoveredTool[]> {
  const session = await initializeMcpSession(server, options);
  const tools: McpDiscoveredTool[] = [];
  let cursor: string | undefined;
  do {
    const result = await rpc<{ tools?: McpDiscoveredTool[]; nextCursor?: string }>(
      session,
      'tools/list',
      cursor ? { cursor } : {},
    );
    tools.push(...(Array.isArray(result.tools) ? result.tools : []));
    cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
  } while (cursor);
  return tools;
}

export async function callRemoteMcpTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
  options: McpClientOptions & { idempotencyKey?: string } = {},
): Promise<McpToolCallResult> {
  const session = await initializeMcpSession(server, options);
  return rpc<McpToolCallResult>(session, 'tools/call', {
    name: toolName,
    arguments: args,
    _meta: options.idempotencyKey ? { ranseToolCallId: options.idempotencyKey } : undefined,
  });
}

async function initializeMcpSession(
  server: McpServer,
  options: McpClientOptions,
): Promise<McpSession> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = buildHeaders(server, options.authSecret);
  const session: McpSession = {
    endpointUrl: server.endpoint_url,
    headers,
    sessionId: null,
    fetchImpl,
    timeoutMs: options.timeoutMs ?? DEFAULT_MCP_HTTP_TIMEOUT_MS,
  };
  const response = await postJson(session, {
    jsonrpc: '2.0',
    id: 'init',
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ranse', version: '0.1.0' },
    },
  });
  session.sessionId = response.headers.get('Mcp-Session-Id') ?? response.headers.get('mcp-session-id');
  const body = await parseMcpResponse<{
    protocolVersion?: string;
    capabilities?: Record<string, unknown>;
    serverInfo?: { name?: string; version?: string };
  }>(response);
  if (!body.protocolVersion) throw new Error('mcp_initialize_missing_protocol_version');
  if (!SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(body.protocolVersion as any)) {
    throw new Error(`mcp_protocol_version_unsupported:${body.protocolVersion}`);
  }

  await postJson(session, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }).catch(() => undefined);
  return session;
}

async function rpc<T>(session: McpSession, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await postJson(session, {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method,
    params,
  });
  return parseMcpResponse<T>(response);
}

async function postJson(session: McpSession, body: Record<string, unknown>): Promise<Response> {
  const headers = new Headers(session.headers);
  if (session.sessionId) headers.set('Mcp-Session-Id', session.sessionId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), session.timeoutMs);
  try {
    const response = await session.fetchImpl(session.endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 202) {
      const detail = await safeReadResponseText(response);
      throw new Error(`mcp_http_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`);
    }
    return response;
  } catch (err) {
    if (controller.signal.aborted) throw new Error('mcp_http_timeout');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseMcpResponse<T>(response: Response): Promise<T> {
  if (response.status === 202 || response.status === 204) return {} as T;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const text = await safeReadResponseText(response);
  const parsed = contentType.includes('text/event-stream') ? parseSseJsonRpc(text) : JSON.parse(text);
  const item = Array.isArray(parsed) ? parsed.find((entry) => entry?.id !== undefined) : parsed;
  if (!item || typeof item !== 'object') throw new Error('mcp_invalid_json_rpc_response');
  const responseBody = item as JsonRpcResponse<T>;
  if ('error' in responseBody) {
    throw new Error(`mcp_rpc_error:${responseBody.error.code}:${responseBody.error.message}`);
  }
  return responseBody.result;
}

async function safeReadResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > MAX_MCP_RESPONSE_BYTES) throw new Error('mcp_response_too_large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_MCP_RESPONSE_BYTES) {
    throw new Error('mcp_response_too_large');
  }
  return text;
}

function parseSseJsonRpc(text: string): unknown {
  const events: string[] = [];
  let current: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      if (current.length) {
        events.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    if (line.startsWith('data:')) current.push(line.slice(5).trimStart());
  }
  if (current.length) events.push(current.join('\n'));
  for (const data of events) {
    if (!data || data === '[DONE]') continue;
    const parsed = JSON.parse(data);
    if (parsed?.id !== undefined || parsed?.result !== undefined || parsed?.error !== undefined) {
      return parsed;
    }
  }
  throw new Error('mcp_empty_sse_response');
}

function buildHeaders(server: McpServer, authSecret?: string | null): Headers {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    'user-agent': 'Ranse/0.1 MCP Client',
  });
  if (server.auth_type === 'bearer') {
    if (!authSecret) throw new Error('mcp_auth_secret_missing');
    headers.set('authorization', `Bearer ${authSecret}`);
  }
  if (server.auth_type === 'header') {
    if (!authSecret) throw new Error('mcp_auth_secret_missing');
    if (!server.auth_header_name) throw new Error('mcp_auth_header_missing');
    headers.set(server.auth_header_name, authSecret);
  }
  return headers;
}

/** HTTP timeout for outbound MCP tool calls. */
export const DEFAULT_MCP_HTTP_TIMEOUT_MS = 30_000;

/** Cap on MCP tool-call response body size. */
export const MAX_MCP_RESPONSE_BYTES = 1_000_000;

/** Header names operators cannot use as the MCP server's auth header — either
 *  reserved (Authorization, Cookie, Host…) or Cloudflare-injected at the edge
 *  (cf-connecting-ip, cf-ray…). Workspace admins picking a custom auth header
 *  for their MCP server are validated against this denylist. */
export const FORBIDDEN_AUTH_HEADERS = new Set([
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

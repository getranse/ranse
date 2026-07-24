import type {
  McpCatalogTemplate,
  McpGuardrailInput,
  McpServerEntry,
  McpServerInput,
  McpToolEntry,
} from '../../types/client/mcp';
import type { McpToolCall, McpToolGuardrail } from '../../types/shared/mcp';
import { api } from './core';

export const mcpApi = {
  mcpCatalog: () => api<{ templates: McpCatalogTemplate[] }>('/api/mcp/catalog'),
  listMcpServers: () => api<{ servers: McpServerEntry[] }>('/api/mcp/servers'),
  createMcpServer: (body: McpServerInput) =>
    api<{ server: McpServerEntry }>('/api/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMcpServer: (id: string, body: Partial<McpServerInput>) =>
    api<{ server: McpServerEntry }>(`/api/mcp/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteMcpServer: (id: string) =>
    api<{ ok: boolean }>(`/api/mcp/servers/${id}`, { method: 'DELETE' }),
  discoverMcpTools: (serverId: string) =>
    api<{ ok: boolean; tools: McpToolEntry[] }>(`/api/mcp/servers/${serverId}/discover`, {
      method: 'POST',
    }),
  listMcpTools: (serverId?: string) =>
    api<{ tools: McpToolEntry[] }>(`/api/mcp/tools${serverId ? `?server_id=${serverId}` : ''}`),
  setMcpGuardrail: (serverId: string, body: McpGuardrailInput) =>
    api<{ guardrail: McpToolGuardrail }>(`/api/mcp/servers/${serverId}/guardrails`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listMcpToolCalls: (ticketId: string) =>
    api<{ toolCalls: McpToolCall[] }>(`/api/mcp/tool-calls?ticket_id=${ticketId}`),
};

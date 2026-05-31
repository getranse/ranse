import type { McpServer, McpServerListItem, McpTool, McpToolGuardrail, EffectiveMcpToolGuardrail, McpToolCall, McpDiscoveredTool } from '../../interfaces/mcp';
export type { McpServer, McpServerListItem, McpTool, McpToolGuardrail, EffectiveMcpToolGuardrail, McpToolCall, McpDiscoveredTool };
export const MCP_AUTH_TYPES = ['none', 'bearer', 'header'] as const;
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number];
export type McpToolCallStatus = 'pending_approval' | 'running' | 'completed' | 'failed' | 'blocked';

import type { Env } from '../env';
import type { EffectiveMcpToolGuardrail, McpTool } from '../../types/mcp';
import {
  countMcpToolCallsForTicket,
  countMcpToolCallsSince,
  getMcpToolGuardrail,
} from './storage';

interface GuardrailDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
  blockedReason?: string;
}

export async function evaluateMcpGuardrails(
  env: Env,
  workspaceId: string,
  args: {
    serverId: string;
    tool: McpTool;
    ticketId: string;
    toolArgs: Record<string, unknown>;
    procedureRequiresApproval?: boolean;
    customerSegment?: string | null;
  },
): Promise<GuardrailDecision> {
  const guardrail = await getEffectiveMcpGuardrail(env, workspaceId, args.serverId, args.tool);
  const reasons: string[] = [];
  if (!guardrail.enabled) {
    return {
      allowed: false,
      requiresApproval: true,
      reasons,
      blockedReason: 'mcp_tool_disabled',
    };
  }

  if (guardrail.max_calls_per_ticket !== null) {
    const count = await countMcpToolCallsForTicket(
      env,
      workspaceId,
      args.serverId,
      args.tool.name,
      args.ticketId,
    );
    if (count >= guardrail.max_calls_per_ticket) {
      return {
        allowed: false,
        requiresApproval: true,
        reasons,
        blockedReason: 'mcp_ticket_rate_limit_exceeded',
      };
    }
  }

  if (guardrail.max_calls_per_hour !== null) {
    const count = await countMcpToolCallsSince(
      env,
      workspaceId,
      args.serverId,
      args.tool.name,
      Date.now() - 60 * 60 * 1000,
    );
    if (count >= guardrail.max_calls_per_hour) {
      return {
        allowed: false,
        requiresApproval: true,
        reasons,
        blockedReason: 'mcp_hourly_rate_limit_exceeded',
      };
    }
  }

  if (guardrail.dollar_limit_cents !== null) {
    const amount = extractDollarAmountCents(args.toolArgs);
    if (amount === null) {
      return {
        allowed: false,
        requiresApproval: true,
        reasons,
        blockedReason: 'mcp_amount_unavailable',
      };
    }
    if (amount > guardrail.dollar_limit_cents) {
      return {
        allowed: false,
        requiresApproval: true,
        reasons,
        blockedReason: 'mcp_dollar_limit_exceeded',
      };
    }
  }

  if (guardrail.allowed_customer_segments.length > 0) {
    if (!args.customerSegment || !guardrail.allowed_customer_segments.includes(args.customerSegment)) {
      return {
        allowed: false,
        requiresApproval: true,
        reasons,
        blockedReason: 'mcp_customer_segment_not_allowed',
      };
    }
  }

  if (guardrail.requires_approval) reasons.push('tool_guardrail_requires_approval');
  if (args.tool.destructive_hint === 1) reasons.push('tool_marked_destructive');
  if (args.tool.read_only_hint !== 1) reasons.push('tool_not_marked_read_only');
  if (args.procedureRequiresApproval === true) reasons.push('procedure_requires_approval');

  const procedureOverride = args.procedureRequiresApproval;
  return {
    allowed: true,
    requiresApproval:
      procedureOverride === undefined
        ? guardrail.requires_approval
        : procedureOverride || guardrail.requires_approval,
    reasons,
  };
}

export async function getEffectiveMcpGuardrail(
  env: Env,
  workspaceId: string,
  serverId: string,
  tool: McpTool,
): Promise<EffectiveMcpToolGuardrail> {
  const row = await getMcpToolGuardrail(env, workspaceId, serverId, tool.name);
  const defaultRequiresApproval = !(tool.read_only_hint === 1 && tool.destructive_hint !== 1);
  return {
    enabled: row ? row.enabled === 1 : true,
    requires_approval: row?.requires_approval === null || row?.requires_approval === undefined
      ? defaultRequiresApproval
      : row.requires_approval === 1,
    max_calls_per_ticket: row?.max_calls_per_ticket ?? 5,
    max_calls_per_hour: row?.max_calls_per_hour ?? 60,
    dollar_limit_cents: row?.dollar_limit_cents ?? null,
    allowed_customer_segments: parseStringArray(row?.allowed_customer_segments_json),
  };
}

function extractDollarAmountCents(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const normalized = key.toLowerCase();
    const raw = obj[key];
    if (
      normalized === 'amount_cents' ||
      normalized === 'refund_amount_cents' ||
      normalized === 'total_cents'
    ) {
      const cents = Number(raw);
      if (Number.isFinite(cents)) return Math.round(cents);
    }
    if (
      normalized === 'amount' ||
      normalized === 'amount_usd' ||
      normalized === 'refund_amount' ||
      normalized === 'refund_amount_usd' ||
      normalized === 'total_amount'
    ) {
      const dollars = Number(raw);
      if (Number.isFinite(dollars)) return Math.round(dollars * 100);
    }
  }
  return null;
}

function parseStringArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

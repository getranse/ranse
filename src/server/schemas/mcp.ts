import { z } from 'zod';
import { MCP_AUTH_TYPES } from '../../types/shared/mcp';

const authTypeSchema = z.enum(MCP_AUTH_TYPES);

export const createServerSchema = z.object({
  name: z.string().min(1).max(80),
  endpoint_url: z.string().min(1).max(500),
  auth_type: authTypeSchema.default('none'),
  auth_header_name: z.string().max(80).nullable().optional(),
  auth_secret: z.string().max(5000).optional(),
  enabled: z.boolean().optional(),
});

export const updateServerSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  endpoint_url: z.string().min(1).max(500).optional(),
  auth_type: authTypeSchema.optional(),
  auth_header_name: z.string().max(80).nullable().optional(),
  auth_secret: z.string().max(5000).optional(),
  enabled: z.boolean().optional(),
});

export const guardrailSchema = z.object({
  tool_name: z.string().min(1).max(160),
  enabled: z.boolean().optional(),
  requires_approval: z.boolean().nullable().optional(),
  max_calls_per_ticket: z.number().int().min(1).max(500).nullable().optional(),
  max_calls_per_hour: z.number().int().min(1).max(5000).nullable().optional(),
  dollar_limit_cents: z.number().int().min(1).max(100_000_000).nullable().optional(),
  allowed_customer_segments: z.array(z.string().min(1).max(80)).max(50).optional(),
});

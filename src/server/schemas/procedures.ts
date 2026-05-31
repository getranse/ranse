import { z } from 'zod';
import { PROCEDURE_SOURCE_KINDS } from '../../types/shared/procedure';

export const upsertProcedureBody = z.object({
  spec: z.unknown(),
  source_kind: z.enum(PROCEDURE_SOURCE_KINDS).optional(),
  source_ref: z.string().max(500).nullable().optional(),
});

export const marketplaceInstallBody = z.object({
  entry: z.unknown(),
  source_manifest_url: z.string().url().optional(),
  source_author: z.string().max(200).optional(),
  source_repo: z.string().max(200).optional(),
});

export const runBodySchema = z.object({
  ticket_id: z.string().min(1),
  context: z.record(z.unknown()).optional(),
});

export const resumeBodySchema = z.object({
  event: z.enum(['customer_reply', 'approval_decided', 'manual_resume']),
  payload: z.record(z.unknown()).optional(),
});

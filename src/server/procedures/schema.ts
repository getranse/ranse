import { z } from 'zod';
import type { ProcedureSpec, ProcedureStep } from '../../types/procedure';

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/);
const stepIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,80}$/);
const pathSchema = z.string().min(1).max(120);
const templateSchema = z.string().min(1).max(20000);

export const ProcedureConditionSchema = z
  .object({
    var: pathSchema,
    exists: z.boolean().optional(),
    equals: z.unknown().optional(),
    not_equals: z.unknown().optional(),
  })
  .superRefine((condition, ctx) => {
    if (
      condition.exists === undefined &&
      condition.equals === undefined &&
      condition.not_equals === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Condition needs exists, equals, or not_equals.',
      });
    }
  });

export const ProcedureStepSchema: z.ZodType<ProcedureStep> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      id: stepIdSchema,
      type: z.literal('search'),
      query: templateSchema,
      scope: z.enum(['knowledge', 'resolved_tickets', 'customer_data', 'all']).optional(),
      max_hops: z.number().int().min(1).max(5).optional(),
      save_as: pathSchema.optional(),
    }),
    z.object({ id: stepIdSchema, type: z.literal('add_note'), body: templateSchema }),
    z.object({
      id: stepIdSchema,
      type: z.literal('ask_customer'),
      message: templateSchema,
      subject: z.string().min(1).max(998).optional(),
    }),
    z.object({
      id: stepIdSchema,
      type: z.literal('set_ticket_field'),
      field: z.enum(['status', 'priority', 'category']),
      value: z.string().min(1).max(120),
    }),
    z.object({
      id: stepIdSchema,
      type: z.literal('escalate_to'),
      route_to: z.string().min(1).max(120),
      severity: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      reason: z.string().max(1000).optional(),
    }),
    z.object({
      id: stepIdSchema,
      type: z.literal('wait_for_event'),
      event: z.enum(['customer_reply', 'approval_decided']),
      timeout_ms: z
        .number()
        .int()
        .min(1_000)
        .max(30 * 24 * 60 * 60 * 1000)
        .optional(),
    }),
    z.object({
      id: stepIdSchema,
      type: z.literal('call_action'),
      tool: z.string().min(1).max(160),
      args: z.record(z.unknown()).optional(),
      requires_approval: z.boolean().optional(),
      save_as: pathSchema.optional(),
    }),
    z.object({
      id: stepIdSchema,
      type: z.literal('if'),
      condition: ProcedureConditionSchema,
      // biome-ignore lint/suspicious/noThenProperty: Procedure specs intentionally use if/then/else terminology.
      then: z.array(ProcedureStepSchema).min(1).max(50),
      else: z.array(ProcedureStepSchema).max(50).optional(),
    }),
    z.object({
      id: stepIdSchema,
      type: z.literal('loop'),
      each: pathSchema,
      as: z.string().min(1).max(60).optional(),
      max_iterations: z.number().int().min(1).max(100).optional(),
      steps: z.array(ProcedureStepSchema).min(1).max(50),
    }),
  ]),
);

export const ProcedureSpecSchema: z.ZodType<ProcedureSpec> = z
  .object({
    slug: slugSchema,
    name: z.string().min(2).max(160),
    version: z.string().min(1).max(80),
    description: z.string().max(1000).optional(),
    owner: z.string().max(160).optional(),
    trigger: z.object({
      type: z.enum(['manual', 'ticket_created', 'intent']),
      category: z.string().max(120).optional(),
      intent: z.string().max(160).optional(),
    }),
    steps: z.array(ProcedureStepSchema).min(1).max(100),
    evals: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          input: z.record(z.unknown()),
          expect: z.record(z.unknown()).optional(),
        }),
      )
      .max(50)
      .optional(),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    let total = 0;
    const visit = (steps: ProcedureStep[]) => {
      for (const step of steps) {
        total += 1;
        if (ids.has(step.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps'],
            message: `Duplicate step id "${step.id}".`,
          });
        }
        ids.add(step.id);
        if (step.type === 'if') visit([...(step.then ?? []), ...(step.else ?? [])]);
        if (step.type === 'loop') visit(step.steps);
      }
    };
    visit(spec.steps);
    if (total > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: 'A procedure can contain at most 100 steps including nested steps.',
      });
    }
  });

export function normalizeProcedureSpec(input: unknown): ProcedureSpec {
  return ProcedureSpecSchema.parse(input);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

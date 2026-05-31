import { z } from 'zod';
import { KNOWLEDGE_SEARCH_SCOPES } from '../../types/shared/knowledge';

export const createSourceBody = z
  .object({
    kind: z.enum(['manual', 'url']).default('manual'),
    title: z.string().min(1).max(300).optional(),
    body: z.string().min(1).max(500000).optional(),
    url: z.string().url().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'manual' && !value.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: 'Manual sources need a body.' });
    }
    if (value.kind === 'url' && !value.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'URL sources need a URL.' });
    }
  });

export const searchBody = z.object({
  query: z.string().min(1).max(4000),
  limit: z.number().int().min(1).max(20).optional(),
  max_hops: z.number().int().min(1).max(5).optional(),
  scope: z.enum(KNOWLEDGE_SEARCH_SCOPES).optional(),
});

export const importResolvedBody = z.object({ limit: z.number().int().min(1).max(200).optional() });

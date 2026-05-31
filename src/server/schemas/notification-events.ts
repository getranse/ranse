import { z } from 'zod';

export const ticketCreatedPayload = z.object({
  ticketId: z.string(),
  subject: z.string(),
  requesterEmail: z.string(),
  requesterName: z.string().nullable(),
  preview: z.string(),
  mailboxAddress: z.string(),
  receivedAt: z.number(),
});

export const messageInboundPayload = z.object({
  ticketId: z.string(),
  messageId: z.string(),
  subject: z.string(),
  fromAddress: z.string(),
  fromName: z.string().nullable(),
  preview: z.string(),
  isReplyToExisting: z.boolean(),
  receivedAt: z.number(),
});

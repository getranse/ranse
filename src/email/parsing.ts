import PostalMime, { type Email } from 'postal-mime';
import type { ForwardableEmailMessage } from '@cloudflare/workers-types';

export interface ParsedInbound {
  from: { address: string; name?: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  date?: Date;
  headers: Record<string, string>;
  attachments: Array<{ filename: string; mimeType: string; size: number; content: ArrayBuffer }>;
  isAutoReply: boolean;
  rawBytes: Uint8Array;
}

function headerMap(headers: Email['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.key.toLowerCase()] = h.value;
  return out;
}

function isAutoReplyHeaders(h: Record<string, string>): boolean {
  const autoSubmitted = h['auto-submitted'];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return true;
  const precedence = h['precedence']?.toLowerCase();
  if (precedence && ['bulk', 'auto_reply', 'junk', 'list'].includes(precedence)) return true;
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']) return true;
  return false;
}

async function readBody(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export async function parseInbound(msg: ForwardableEmailMessage): Promise<ParsedInbound> {
  const raw = await readBody(msg.raw as ReadableStream<Uint8Array>);
  const parsed = await PostalMime.parse(raw);
  const headers = headerMap(parsed.headers ?? []);
  const atts = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename ?? 'attachment',
    mimeType: a.mimeType ?? 'application/octet-stream',
    size: (a.content as ArrayBuffer).byteLength,
    content: a.content as ArrayBuffer,
  }));
  return {
    from: { address: parsed.from?.address ?? msg.from, name: parsed.from?.name },
    to: (parsed.to ?? []).map((a) => a.address).filter(Boolean) as string[],
    cc: (parsed.cc ?? []).map((a) => a.address).filter(Boolean) as string[],
    subject: parsed.subject ?? '(no subject)',
    text: parsed.text ?? '',
    html: parsed.html,
    messageId: parsed.messageId ?? headers['message-id'] ?? crypto.randomUUID(),
    inReplyTo: parsed.inReplyTo ?? headers['in-reply-to'],
    references: parsed.references
      ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
      : (headers['references']?.split(/\s+/).filter(Boolean) ?? []),
    date: parsed.date ? new Date(parsed.date) : undefined,
    headers,
    attachments: atts,
    isAutoReply: isAutoReplyHeaders(headers),
    rawBytes: raw,
  };
}

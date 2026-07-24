import type { BounceInfo, ParsedInbound } from '../../../interfaces/email';

const FAILURE_TEXT =
  /(delivery (has )?failed|could not be delivered|undeliverable|address not found|user unknown|mailbox unavailable)/i;

function dsnBody(parsed: ParsedInbound): string {
  const part = parsed.attachments.find((a) => a.mimeType === 'message/delivery-status');
  if (part) return new TextDecoder().decode(part.content);
  return parsed.text;
}

function field(body: string, name: string): string | null {
  const m = body.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return m ? m[1].trim() : null;
}

function recipientFrom(body: string, headers: Record<string, string>): string | null {
  const raw =
    field(body, 'Final-Recipient') ??
    field(body, 'Original-Recipient') ??
    headers['x-failed-recipients'] ??
    null;
  if (!raw) return null;
  // Final-Recipient: rfc822; user@example.com
  const addr = raw.split(';').pop()?.trim() ?? raw.trim();
  return /@/.test(addr) ? addr.toLowerCase() : null;
}

/**
 * Detect a delivery status notification (bounce). Returns null for ordinary
 * mail. DSNs must never enter the triage/draft pipeline: replying to a
 * mailer-daemon creates a loop, and the failed address must stop receiving
 * auto-sends.
 */
export function detectBounce(parsed: ParsedInbound): BounceInfo | null {
  const contentType = parsed.headers['content-type'] ?? '';
  const isDsn = /report-type=delivery-status/i.test(contentType);
  const fromDaemon = /^(mailer-daemon|postmaster)@/i.test(parsed.from.address ?? '');
  if (!isDsn && !fromDaemon) return null;

  const body = dsnBody(parsed);
  const action = field(body, 'Action')?.toLowerCase() ?? null;
  const status = field(body, 'Status');

  if (isDsn) {
    // Per RFC 3464 only 'failed' means the message never arrived; delayed /
    // delivered / relayed notifications are informational, not bounces.
    if (action && action !== 'failed') return null;
    const kind = status?.startsWith('4') || action === 'delayed' ? 'soft' : 'hard';
    return { kind, recipient: recipientFrom(body, parsed.headers), status };
  }

  // mailer-daemon mail without a structured DSN: only treat clear failure
  // language as a bounce, and assume hard (postmaster mail about a transient
  // issue is rare, and a false soft-suppress is harmless).
  if (!FAILURE_TEXT.test(`${parsed.subject}\n${body}`)) return null;
  return { kind: 'hard', recipient: recipientFrom(body, parsed.headers), status };
}

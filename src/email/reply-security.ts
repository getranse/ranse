import { hmacSign, hmacVerify } from '../lib/crypto';

/**
 * Reply addresses use the pattern:
 *   reply+{ticketId}.{sig8}@support.example.com
 * sig8 = first 8 hex chars of HMAC(reply_signing_secret, ticketId).
 * This prevents spoofed replies from pasting a random ticketId into `To`.
 */

const ADDR_RE = /^reply\+([A-Za-z0-9_-]+)\.([a-f0-9]{8})@/i;

export async function buildReplyAddress(params: {
  supportDomain: string;
  ticketId: string;
  mailboxSecret: string;
}): Promise<string> {
  const sig = await hmacSign(params.mailboxSecret, params.ticketId);
  return `reply+${params.ticketId}.${sig.slice(0, 8)}@${params.supportDomain}`;
}

export async function parseReplyAddress(
  address: string,
  mailboxSecret: string,
): Promise<{ ticketId: string } | null> {
  const m = address.match(ADDR_RE);
  if (!m) return null;
  const [, ticketId, sig8] = m;
  const full = await hmacSign(mailboxSecret, ticketId);
  return hmacVerify(full.slice(0, 8), sig8) ? { ticketId } : null;
}

export function shouldSuppressAutoReply(isAutoReply: boolean, consecutiveAutoReplies: number): boolean {
  // Strict: never reply to auto-replies; break loops after 2 consecutive autos in a thread.
  if (isAutoReply) return true;
  if (consecutiveAutoReplies >= 2) return true;
  return false;
}

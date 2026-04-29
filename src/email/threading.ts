/**
 * Build a raw RFC 822 message for an outbound reply, including the headers
 * that make recipient mail clients (Gmail, Outlook, Apple Mail) thread
 * the reply with the original conversation:
 *
 *   - Message-ID: stable id we mint for this outbound message; lets future
 *     inbound replies match this thread via In-Reply-To.
 *   - In-Reply-To: the rfc_message_id of the customer's most recent
 *     inbound message in this ticket — the direct parent.
 *   - References: chain of all prior message ids in the thread (oldest
 *     first), so even if the recipient's client drops a node, the chain
 *     still resolves.
 *
 * Body is plain text (we don't render HTML for now). Headers use CRLF
 * line endings as required by RFC 5322.
 */
export interface ThreadedMimeOpts {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string; // bare, without surrounding angle brackets
  inReplyTo?: string;
  references?: string[];
  date?: Date;
}

function escapeHeaderValue(s: string): string {
  // Strip CR/LF so a user-controlled subject can't inject headers.
  return s.replace(/[\r\n]+/g, ' ').trim();
}

export function buildThreadedMime(opts: ThreadedMimeOpts): Uint8Array {
  const date = (opts.date ?? new Date()).toUTCString();
  const lines: string[] = [
    `Date: ${date}`,
    `From: ${escapeHeaderValue(opts.from)}`,
    `To: ${escapeHeaderValue(opts.to)}`,
    `Subject: ${escapeHeaderValue(opts.subject)}`,
    `Message-ID: <${opts.messageId}>`,
  ];
  if (opts.inReplyTo) lines.push(`In-Reply-To: <${opts.inReplyTo}>`);
  if (opts.references && opts.references.length > 0) {
    // RFC 5322 caps a header line at 998 octets; if the chain grows long
    // we keep only the first reference and the last few — that's the
    // canonical "fold" recipient clients accept.
    const refs = opts.references.length > 10
      ? [opts.references[0], ...opts.references.slice(-9)]
      : opts.references;
    lines.push(`References: ${refs.map((r) => `<${r}>`).join(' ')}`);
  }
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('Content-Transfer-Encoding: 8bit');

  const headers = lines.join('\r\n');
  const body = opts.body.replace(/\r?\n/g, '\r\n');
  return new TextEncoder().encode(`${headers}\r\n\r\n${body}`);
}

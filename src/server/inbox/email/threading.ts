import type { ThreadedMimeOpts } from '../../../interfaces/email';
export type { ThreadedMimeOpts };


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
  if (opts.replyTo) lines.push(`Reply-To: ${escapeHeaderValue(opts.replyTo)}`);
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

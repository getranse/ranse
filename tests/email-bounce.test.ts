import { describe, expect, it } from 'vitest';
import type { ParsedInbound } from '../src/interfaces/email';
import { detectBounce } from '../src/server/inbox/email/bounce';

function inbound(over: Partial<ParsedInbound>): ParsedInbound {
  return {
    from: { address: 'customer@example.com' },
    to: ['support@acme.com'],
    cc: [],
    subject: 'Hello',
    text: 'Just a normal question',
    html: undefined,
    messageId: 'mid-1',
    inReplyTo: undefined,
    references: [],
    headers: {},
    attachments: [],
    isAutoReply: false,
    rawBytes: new Uint8Array(),
    ...over,
  } as ParsedInbound;
}

const DSN_TEXT = `Reporting-MTA: dns; mx.example.com
Final-Recipient: rfc822; gone@customer.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 user unknown`;

describe('bounce detection', () => {
  it('parses a structured DSN into a hard bounce with the failed recipient', () => {
    const bounce = detectBounce(
      inbound({
        from: { address: 'mailer-daemon@mx.example.com' },
        headers: { 'content-type': 'multipart/report; report-type=delivery-status' },
        text: DSN_TEXT,
      }),
    );
    expect(bounce).toEqual({ kind: 'hard', recipient: 'gone@customer.com', status: '5.1.1' });
  });

  it('classifies 4.x.x statuses as soft and ignores non-failure DSN actions', () => {
    const soft = detectBounce(
      inbound({
        headers: { 'content-type': 'multipart/report; report-type=delivery-status' },
        text: DSN_TEXT.replace('Status: 5.1.1', 'Status: 4.4.1'),
      }),
    );
    expect(soft?.kind).toBe('soft');

    const delivered = detectBounce(
      inbound({
        headers: { 'content-type': 'multipart/report; report-type=delivery-status' },
        text: DSN_TEXT.replace('Action: failed', 'Action: delivered'),
      }),
    );
    expect(delivered).toBeNull();
  });

  it('treats mailer-daemon failure prose as a bounce but ordinary mail as not', () => {
    const prose = detectBounce(
      inbound({
        from: { address: 'MAILER-DAEMON@googlemail.com' },
        subject: 'Delivery Status Notification (Failure)',
        text: 'Your message could not be delivered to gone@customer.com.',
        headers: { 'x-failed-recipients': 'gone@customer.com' },
      }),
    );
    expect(prose).toEqual({ kind: 'hard', recipient: 'gone@customer.com', status: null });

    expect(detectBounce(inbound({}))).toBeNull();
  });
});

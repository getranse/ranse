export interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

// Reply/signature interfaces live in ./replies.ts.

export interface BounceInfo {
  /** hard = permanent failure (5.x.x), soft = transient (4.x.x). */
  kind: 'hard' | 'soft';
  /** Failed recipient extracted from the DSN, if present. */
  recipient: string | null;
  /** RFC 3463 status code (e.g. 5.1.1), if present. */
  status: string | null;
}

/**
 * Build a multipart/alternative raw MIME message. text/plain part comes
 * first (per RFC 2046 — clients that prefer plain text get the simpler
 * version), HTML second.
 */
export interface MultipartHeaders {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  date?: string;
  inReplyTo?: string;
  references?: string[];
  replyTo?: string;
}

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

export interface RoutedMailbox {
  workspaceId: string;
  mailboxId: string;
  mailboxAddress: string;
  replySigningSecret: string;
  ticketId?: string;
}

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
  /**
   * Reply-To address. Lets us send From a DKIM-signed sending subdomain
   * (e.g. mail.<apex>, where Email Sending is authorized) while still
   * routing the customer's reply back to the apex (where Email Routing
   * lives). Most modern mail clients honor Reply-To when the user hits
   * Reply.
   */
  replyTo?: string;
  date?: Date;
}

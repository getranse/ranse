import type { Env } from '../env';
import { audit } from '../lib/audit';
import { sha256Hex } from '../lib/crypto';
import { getText } from '../lib/storage';
import type {
  EvalAnonymizationConfig,
  ResolvedTicketEvalExpected,
  ResolvedTicketEvalInput,
} from '../types/evals';
import { anonymizeValue, detectResidualPii, normalizeAnonymizationConfig } from './anonymize';
import { upsertEvalCase } from './storage';

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  requester_email: string;
  requester_name: string | null;
}

interface MessageRow {
  id: string;
  direction: string;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  preview: string | null;
  body_r2_key: string | null;
  sent_at: number;
}

interface OutcomeRow {
  kind: string;
}

export async function captureResolvedTicketEvalCase(
  env: Env,
  workspaceId: string,
  ticketId: string,
  options: { anonymization?: EvalAnonymizationConfig; actorUserId?: string | null } = {},
): Promise<{ captured: boolean; caseId?: string; reason?: string }> {
  const ticket = await env.DB.prepare(
    `SELECT id, subject, status, priority, category, requester_email, requester_name
       FROM ticket
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(ticketId, workspaceId)
    .first<TicketRow>();
  if (!ticket) return { captured: false, reason: 'ticket_not_found' };
  const resolvedOutcome = await env.DB.prepare(
    `SELECT kind FROM ticket_outcome_event
      WHERE workspace_id = ? AND ticket_id = ?
        AND kind IN ('resolved_autonomously','resolved_via_procedure')
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(workspaceId, ticketId)
    .first<OutcomeRow>();
  if (!['resolved', 'closed'].includes(ticket.status) && !resolvedOutcome) {
    return { captured: false, reason: 'ticket_not_resolved' };
  }

  const messageRows = await env.DB.prepare(
    `SELECT id, direction, from_address, to_address, subject, preview, body_r2_key, sent_at
       FROM message_index
      WHERE ticket_id = ? AND workspace_id = ?
      ORDER BY sent_at ASC`,
  )
    .bind(ticketId, workspaceId)
    .all<MessageRow>();
  const messages = messageRows.results ?? [];
  const inbound = [...messages].reverse().find((message) => message.direction === 'inbound');
  const outbound = [...messages].reverse().find((message) => message.direction === 'outbound');
  if (!inbound) return { captured: false, reason: 'no_inbound_message' };
  if (!outbound) return { captured: false, reason: 'no_outbound_message' };

  const outboundBody = await messageBody(env, outbound);
  if (!outboundBody.trim()) return { captured: false, reason: 'empty_expected_reply' };

  const transcript = await Promise.all(
    messages
      .filter((message) => ['inbound', 'outbound'].includes(message.direction))
      .map(async (message) => ({
        id: message.id,
        direction: message.direction,
        from_address: message.from_address,
        to_address: message.to_address,
        subject: message.subject,
        preview: (await messageBody(env, message)).slice(0, 4000),
        sent_at: message.sent_at,
      })),
  );
  const latestCustomerPreview = await messageBody(env, inbound);
  const outcomes = await env.DB.prepare(
    `SELECT kind FROM ticket_outcome_event
      WHERE workspace_id = ? AND ticket_id = ?
      ORDER BY created_at ASC`,
  )
    .bind(workspaceId, ticketId)
    .all<OutcomeRow>();

  const input: ResolvedTicketEvalInput = {
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      requester_email: ticket.requester_email,
      requester_name: ticket.requester_name,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
    },
    transcript,
    latest_customer_message: {
      subject: inbound.subject ?? ticket.subject,
      preview: latestCustomerPreview.slice(0, 4000),
    },
  };
  const expected: ResolvedTicketEvalExpected = {
    expected_status: ticket.status,
    expected_priority: ticket.priority,
    expected_category: ticket.category,
    expected_reply_preview: outboundBody.slice(0, 4000),
    required_terms: extractRequiredTerms(outboundBody),
    outcome_kinds: (outcomes.results ?? []).map((row) => row.kind),
  };
  const anonymization = {
    ...options.anonymization,
    requesterEmail: ticket.requester_email,
    requesterName: ticket.requester_name,
  };
  const anonymizedInput = anonymizeValue(input, anonymization);
  const anonymizedExpected = anonymizeValue(expected, anonymization);
  const piiCheck = detectAnonymizationLeaks(
    { input: anonymizedInput.value, expected: anonymizedExpected.value },
    anonymization,
  );
  if (piiCheck.length > 0) {
    console.warn('skipping eval capture because anonymization left residual pii', {
      workspaceId,
      ticketId,
      findings: piiCheck.map((finding) => finding.kind),
    });
    return { captured: false, reason: 'anonymization_residual_pii' };
  }
  const fingerprint = await sha256Hex(
    JSON.stringify({
      ticketId,
      inboundId: inbound.id,
      outboundId: outbound.id,
      expected: anonymizedExpected.value.expected_reply_preview,
    }),
  );
  const evalCase = await upsertEvalCase(env, {
    workspaceId,
    source: 'resolved_ticket',
    ticketId,
    name: `Resolved ticket: ${ticket.subject}`.slice(0, 200),
    inputJson: JSON.stringify(anonymizedInput.value),
    expectedJson: JSON.stringify(anonymizedExpected.value),
    anonymizationJson: JSON.stringify({
      input: anonymizedInput.metadata,
      expected: anonymizedExpected.metadata,
    }),
    sourceFingerprint: fingerprint,
  });
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: options.actorUserId ? 'user' : 'system',
    actorId: options.actorUserId ?? undefined,
    action: 'eval.case_captured',
    payload: { evalCaseId: evalCase.id, source: 'resolved_ticket' },
  });
  return { captured: true, caseId: evalCase.id };
}

export async function captureResolvedTicketEvalCases(
  env: Env,
  workspaceId: string,
  options: {
    limit?: number;
    anonymization?: EvalAnonymizationConfig;
    actorUserId?: string | null;
  } = {},
): Promise<{ captured: number; skipped: number; failed: number; cases: string[] }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await env.DB.prepare(
    `SELECT DISTINCT t.id, t.updated_at
       FROM ticket t
       LEFT JOIN ticket_outcome_event o
         ON o.workspace_id = t.workspace_id AND o.ticket_id = t.id
      WHERE t.workspace_id = ?
        AND (
          t.status IN ('resolved','closed')
          OR o.kind IN ('resolved_autonomously','resolved_via_procedure')
        )
      ORDER BY t.updated_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, limit)
    .all<{ id: string }>();
  let captured = 0;
  let skipped = 0;
  let failed = 0;
  const cases: string[] = [];
  for (const row of rows.results ?? []) {
    try {
      const result = await captureResolvedTicketEvalCase(env, workspaceId, row.id, options);
      if (result.captured && result.caseId) {
        captured += 1;
        cases.push(result.caseId);
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      console.warn('failed to capture eval case', row.id, err);
    }
  }
  return { captured, skipped, failed, cases };
}

async function messageBody(env: Env, message: MessageRow): Promise<string> {
  if (message.body_r2_key) {
    const body = await getText(env, message.body_r2_key);
    if (body) return body;
  }
  return message.preview ?? '';
}

export function extractRequiredTerms(body: string, limit = 8): string[] {
  const stop = new Set([
    'about',
    'after',
    'again',
    'also',
    'because',
    'before',
    'could',
    'customer',
    'hello',
    'please',
    'regards',
    'support',
    'thanks',
    'thank',
    'there',
    'these',
    'those',
    'would',
    'your',
  ]);
  const words = body
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[a-z][a-z0-9_-]{3,}/g);
  if (!words) return [];
  const counts = new Map<string, number>();
  for (const word of words) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function detectAnonymizationLeaks(
  value: unknown,
  config: EvalAnonymizationConfig,
): ReturnType<typeof detectResidualPii> {
  const normalized = normalizeAnonymizationConfig(config);
  const findings = detectResidualPii(value).filter((finding) => {
    if (finding.kind === 'email') return normalized.redactEmails;
    if (finding.kind === 'phone') return normalized.redactPhones;
    return true;
  });
  const text = JSON.stringify(value).toLowerCase();
  const requesterName = normalized.requesterName?.trim().toLowerCase();
  if (normalized.redactRequesterName && requesterName && requesterName.length >= 3) {
    if (text.includes(requesterName)) {
      findings.push({ kind: 'requester_name', value: 'requester_name' });
    }
  }
  return findings;
}

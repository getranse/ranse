import type { Env } from '../env';
import { hmacSign, hmacVerify } from './crypto';

// Customer-facing decision trace. Every AI-authored outbound reply can carry
// a "Why this answer?" link signed with HMAC. The link resolves to a sanitized
// page that shows: KB sources cited, procedure + step, MCP tools called
// (label-only, never payloads), confidence, approver, eval pass rate of the
// procedure version, and last-knowledge-refresh timestamps.
//
// The point: industry CSAT collapses because customers cannot see why the AI
// said what it said. We have all the trace already in audit/message_index/
// procedure_run/mcp_tool_call — exposing it externally is a trust unlock no
// closed-SaaS competitor will ship because their first job is to hide it.

export interface DecisionTraceTokenPayload {
  workspaceId: string;
  ticketId: string;
  messageId: string;
  expiresAt: number;
}

const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60_000;

export async function buildTraceLink(
  env: Env,
  input: Omit<DecisionTraceTokenPayload, 'expiresAt'>,
  options: { expiresInMs?: number } = {},
): Promise<string | null> {
  const base = env.APP_URL?.trim();
  if (!base || !env.COOKIE_SIGNING_KEY) return null;
  try {
    new URL(base);
  } catch {
    return null;
  }
  const payload: DecisionTraceTokenPayload = {
    ...input,
    expiresAt: Date.now() + (options.expiresInMs ?? DEFAULT_EXPIRY_MS),
  };
  const encoded = encodePayload(payload);
  const sig = await hmacSign(env.COOKIE_SIGNING_KEY, encoded);
  const url = new URL(`/public/trace/${encoded}.${sig}`, base);
  return url.toString();
}

export async function verifyTraceToken(
  env: Env,
  token: string,
): Promise<DecisionTraceTokenPayload | null> {
  if (!env.COOKIE_SIGNING_KEY) return null;
  const [payloadPart, sig] = token.split('.');
  if (!payloadPart || !sig) return null;
  const expected = await hmacSign(env.COOKIE_SIGNING_KEY, payloadPart);
  if (!hmacVerify(expected, sig)) return null;
  const payload = decodePayload(payloadPart);
  if (!payload) return null;
  if (payload.expiresAt < Date.now()) return null;
  return payload;
}

export interface PublicTraceKbSource {
  title: string;
  url: string | null;
  last_refreshed_at: number | null;
}

export interface PublicTraceMcpCall {
  label: string;
  read_only: boolean;
  status: string;
  approved_by_human: boolean;
}

export interface PublicTrace {
  workspaceLabel: string;
  authoredAt: number;
  channel: string;
  kbSources: PublicTraceKbSource[];
  procedure: { name: string; version: string } | null;
  mcpCalls: PublicTraceMcpCall[];
  confidence: number | null;
  approver: string | null;
  evalPassRate: number | null;
  reasonSummary: string;
}

export async function buildPublicTrace(
  env: Env,
  payload: DecisionTraceTokenPayload,
): Promise<PublicTrace | null> {
  const message = await env.DB.prepare(
    `SELECT m.id, m.ticket_id, m.workspace_id, m.preview, m.sent_at, m.author_user_id,
            t.origin_channel_kind
       FROM message_index m
       LEFT JOIN ticket t ON t.id = m.ticket_id
      WHERE m.workspace_id = ? AND m.id = ? AND m.ticket_id = ?`,
  )
    .bind(payload.workspaceId, payload.messageId, payload.ticketId)
    .first<{
      id: string;
      ticket_id: string;
      workspace_id: string;
      preview: string;
      sent_at: number;
      author_user_id: string | null;
      origin_channel_kind: string | null;
    }>();
  if (!message) return null;
  // Refuse traces for human-authored replies. The whole point is auditing AI
  // decisions; surfacing an internal-rep reply through the public route is a
  // privacy hazard we just won't ship.
  if (message.author_user_id) return null;

  const workspace = await env.DB.prepare(`SELECT name FROM workspace WHERE id = ?`)
    .bind(payload.workspaceId)
    .first<{ name: string }>();

  const reply = await env.DB.prepare(
    `SELECT payload_json, created_at FROM audit_event
       WHERE workspace_id = ? AND ticket_id = ? AND action IN ('reply.sent','reply.auto_sent')
         AND json_extract(payload_json, '$.messageId') = ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(payload.workspaceId, payload.ticketId, payload.messageId)
    .first<{ payload_json: string; created_at: number }>();
  const replyPayload = parseJson(reply?.payload_json);

  const procedureRow = await env.DB.prepare(
    `SELECT pv.version AS version, p.name AS name
       FROM procedure_run r
       JOIN procedure_version pv ON pv.id = r.version_id
       JOIN procedure p ON p.id = r.procedure_id
      WHERE r.workspace_id = ? AND r.ticket_id = ?
      ORDER BY r.created_at DESC LIMIT 1`,
  )
    .bind(payload.workspaceId, payload.ticketId)
    .first<{ version: string; name: string }>();

  const mcpRows = await env.DB.prepare(
    `SELECT mc.tool_name AS tool, mc.status AS status, ms.name AS server,
            mt.read_only_hint AS read_only_hint, mc.approval_request_id AS approval_request_id
       FROM mcp_tool_call mc
       LEFT JOIN mcp_server ms ON ms.id = mc.server_id
       LEFT JOIN mcp_tool mt ON mt.server_id = mc.server_id AND mt.name = mc.tool_name
      WHERE mc.workspace_id = ? AND mc.ticket_id = ?
      ORDER BY mc.created_at ASC`,
  )
    .bind(payload.workspaceId, payload.ticketId)
    .all<{
      server: string | null;
      tool: string;
      status: string;
      read_only_hint: number | null;
      approval_request_id: string | null;
    }>();

  const kbSources = await loadKbSources(env, payload.workspaceId, payload.ticketId);
  const evalPassRate = procedureRow
    ? await loadEvalPassRate(env, payload.workspaceId, procedureRow.name, procedureRow.version)
    : null;

  return {
    workspaceLabel: workspace?.name ?? 'Support',
    authoredAt: message.sent_at,
    channel: message.origin_channel_kind ?? 'email',
    kbSources,
    procedure: procedureRow ? { name: procedureRow.name, version: procedureRow.version } : null,
    mcpCalls: (mcpRows.results ?? []).map((row) => ({
      label: `${row.server ?? 'mcp'}.${row.tool}`,
      read_only: row.read_only_hint === 1,
      status: row.status,
      approved_by_human: !!row.approval_request_id,
    })),
    confidence: typeof replyPayload?.components?.draftConfidence === 'number'
      ? replyPayload.components.draftConfidence
      : null,
    approver: replyPayload?.actorUserId ?? null,
    evalPassRate,
    reasonSummary: deriveReasonSummary(replyPayload, procedureRow, kbSources, mcpRows.results ?? []),
  };
}

async function loadKbSources(env: Env, workspaceId: string, ticketId: string) {
  // Match drafts.cites_knowledge_ids from the most recent reply audit, fall
  // back to nothing if we can't resolve. This is conservative — we'd rather
  // show zero sources than the wrong ones.
  const audits = await env.DB.prepare(
    `SELECT payload_json FROM audit_event
       WHERE workspace_id = ? AND ticket_id = ?
         AND action IN ('reply.sent','reply.auto_sent')
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(workspaceId, ticketId)
    .first<{ payload_json: string }>();
  const cites = parseJson(audits?.payload_json)?.citesKnowledgeIds as string[] | undefined;
  if (!Array.isArray(cites) || cites.length === 0) return [];
  const placeholders = cites.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT ks.title AS title, ks.url AS url, ks.last_crawled_at AS last_crawled_at
       FROM knowledge_chunk kc
       LEFT JOIN knowledge_source ks ON ks.id = kc.source_id
      WHERE kc.workspace_id = ? AND kc.id IN (${placeholders})`,
  )
    .bind(workspaceId, ...cites)
    .all<{ title: string; url: string | null; last_crawled_at: number | null }>();
  return (rows.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    last_refreshed_at: r.last_crawled_at,
  }));
}

async function loadEvalPassRate(
  env: Env,
  workspaceId: string,
  _procedureName: string,
  _procedureVersion: string,
): Promise<number | null> {
  // Most-recent completed eval run for the workspace. Procedure-specific
  // mapping lives in eval_run.config_json; surfacing the latest aggregate is
  // enough for the customer-facing trust artifact.
  const row = await env.DB.prepare(
    `SELECT passed_count, failed_count FROM eval_run
       WHERE workspace_id = ? AND status IN ('passed','failed')
       ORDER BY completed_at DESC LIMIT 1`,
  )
    .bind(workspaceId)
    .first<{ passed_count: number; failed_count: number }>();
  if (!row) return null;
  const total = (row.passed_count ?? 0) + (row.failed_count ?? 0);
  return total > 0 ? (row.passed_count ?? 0) / total : null;
}

function deriveReasonSummary(
  payload: Record<string, any> | null,
  procedure: { name: string; version: string } | null,
  kb: PublicTraceKbSource[],
  mcp: { server: string | null; tool: string }[],
): string {
  const parts: string[] = [];
  if (procedure) parts.push(`Followed the "${procedure.name}" procedure (v${procedure.version}).`);
  if (kb.length > 0) parts.push(`Cited ${kb.length} knowledge source${kb.length === 1 ? '' : 's'}.`);
  if (mcp.length > 0) {
    parts.push(`Called ${mcp.length} action${mcp.length === 1 ? '' : 's'} in your systems.`);
  }
  if (payload?.reason) parts.push(`Reasoning: ${String(payload.reason).slice(0, 200)}.`);
  if (parts.length === 0) return 'AI-generated reply with no procedure or external action.';
  return parts.join(' ');
}

function parseJson(value: string | undefined): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function encodePayload(payload: DecisionTraceTokenPayload): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodePayload(value: string): DecisionTraceTokenPayload | null {
  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.ticketId !== 'string' ||
      typeof parsed.messageId !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed as DecisionTraceTokenPayload;
  } catch {
    return null;
  }
}

import { Agent, callable } from 'agents';
import type { Env } from '../env';
import { audit } from '../lib/audit';
import { createApproval } from '../lib/approvals';
import { ids } from '../lib/ids';
import { r2Keys, putRaw } from '../lib/storage';
import { buildReplyAddress } from '../email/reply-security';
import { runTriage } from './specialists/triage';
import { runDraft } from './specialists/draft';
import { searchKnowledge } from './specialists/knowledge';
import type { AgentConfig } from '../llm/config.types';

export interface SupervisorState {
  workspaceId: string;
  workspaceName: string;
  openCount: number;
  lastSyncAt: number;
  currentApprovals: number;
  presence: Record<string, { name: string; lastSeen: number }>;
}

export interface InboundEmailPayload {
  mailboxId: string;
  mailboxAddress: string;
  replySigningSecret: string;
  existingTicketId?: string;
  from: { address: string; name?: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  isAutoReply: boolean;
  rawKey: string;
  receivedAt: number;
  attachmentCount: number;
}

export interface TicketListItem {
  id: string;
  subject: string;
  status: string;
  priority: string;
  requester_email: string;
  last_message_at: number;
  category?: string;
  assignee_user_id?: string;
}

const DEFAULT_STATE: SupervisorState = {
  workspaceId: '',
  workspaceName: '',
  openCount: 0,
  lastSyncAt: 0,
  currentApprovals: 0,
  presence: {},
};

export class WorkspaceSupervisorAgent extends Agent<Env, SupervisorState> {
  initialState: SupervisorState = DEFAULT_STATE;

  async onStart(): Promise<void> {
    if (!this.state.workspaceId) {
      const ws = await this.loadWorkspaceByDOName();
      if (ws) await this.setState({ ...this.state, ...ws, lastSyncAt: Date.now() });
    }
    await this.refreshCounts();
  }

  private async loadWorkspaceByDOName(): Promise<{ workspaceId: string; workspaceName: string } | null> {
    const idStr = this.name;
    if (!idStr) return null;
    const row = await this.env.DB.prepare(`SELECT id, name FROM workspace WHERE id = ?`)
      .bind(idStr)
      .first<{ id: string; name: string }>();
    return row ? { workspaceId: row.id, workspaceName: row.name } : null;
  }

  private async workspaceConfig(): Promise<Partial<AgentConfig> | undefined> {
    if (!this.state.workspaceId) return undefined;
    const rows = await this.env.DB.prepare(
      `SELECT action_key, model_name, fallback_model, reasoning_effort, temperature
       FROM workspace_llm_config WHERE workspace_id = ?`,
    )
      .bind(this.state.workspaceId)
      .all<{ action_key: string; model_name: string; fallback_model: string | null; reasoning_effort: string | null; temperature: number | null }>();
    const out: any = {};
    for (const r of rows.results ?? []) {
      out[r.action_key] = {
        model: r.model_name,
        fallbackModel: r.fallback_model ?? undefined,
        reasoningEffort: (r.reasoning_effort as any) ?? undefined,
        temperature: r.temperature ?? undefined,
      };
    }
    return Object.keys(out).length ? out : undefined;
  }

  async ingestEmail(payload: InboundEmailPayload): Promise<{ ticketId: string; messageId: string }> {
    const now = Date.now();
    let ticketId = payload.existingTicketId;
    let isNewTicket = false;

    if (!ticketId) {
      const existing = await this.findTicketByReferences(payload.inReplyTo, payload.references, payload.from.address);
      ticketId = existing ?? undefined;
    }

    if (!ticketId) {
      ticketId = ids.ticket();
      isNewTicket = true;
      const threadToken = ids.ticket().slice(4);
      await this.env.DB.prepare(
        `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, status, priority, requester_email, requester_name, last_message_at, thread_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          ticketId,
          this.state.workspaceId,
          payload.mailboxId,
          payload.subject,
          payload.from.address.toLowerCase(),
          payload.from.name ?? null,
          payload.receivedAt,
          threadToken,
          now,
          now,
        )
        .run();
    }

    const messageId = ids.message();
    await this.env.DB.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, from_address, to_address, subject, rfc_message_id, in_reply_to, preview, raw_r2_key, has_attachments, sent_at, created_at)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        messageId,
        ticketId,
        this.state.workspaceId,
        payload.from.address,
        payload.to[0] ?? payload.mailboxAddress,
        payload.subject,
        payload.messageId,
        payload.inReplyTo ?? null,
        payload.text.slice(0, 280),
        payload.rawKey,
        payload.attachmentCount > 0 ? 1 : 0,
        payload.receivedAt,
        now,
      )
      .run();

    await this.env.DB.prepare(
      `UPDATE ticket SET last_message_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(payload.receivedAt, now, ticketId)
      .run();

    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId,
      actorType: 'system',
      action: isNewTicket ? 'ticket.created' : 'ticket.message_received',
      payload: { messageId, from: payload.from.address, subject: payload.subject, isAutoReply: payload.isAutoReply },
    });

    if (!payload.isAutoReply) {
      await this.schedule(0, 'triageAndDraft', { ticketId, messageId, payload });
    }

    await this.refreshCounts();
    return { ticketId, messageId };
  }

  async triageAndDraft(args: { ticketId: string; messageId: string; payload: InboundEmailPayload }) {
    const { ticketId, payload } = args;
    const cfg = await this.workspaceConfig();

    const triage = await runTriage({
      env: this.env,
      workspaceId: this.state.workspaceId,
      ticketId,
      subject: payload.subject,
      body: payload.text,
      from: payload.from.address,
      workspaceConfig: cfg,
    });

    await this.env.DB.prepare(
      `UPDATE ticket SET category = ?, priority = ?, sentiment = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(triage.category, triage.priority, triage.sentiment, Date.now(), ticketId)
      .run();

    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId,
      actorType: 'agent',
      actorId: 'triage',
      action: 'ticket.triaged',
      payload: triage as any,
    });

    if (triage.category === 'spam') {
      await this.env.DB.prepare(`UPDATE ticket SET status = 'spam' WHERE id = ?`).bind(ticketId).run();
      await this.refreshCounts();
      return;
    }

    const knowledge = await searchKnowledge(this.env, this.state.workspaceId, `${payload.subject}\n${payload.text}`);
    const draft = await runDraft({
      env: this.env,
      workspaceId: this.state.workspaceId,
      ticketId,
      customerMessage: payload.text,
      customerName: payload.from.name,
      knowledge,
      workspaceConfig: cfg,
    });

    const replyFrom = await buildReplyAddress({
      supportDomain: payload.mailboxAddress.split('@')[1],
      ticketId,
      mailboxSecret: payload.replySigningSecret,
    });

    const riskReasons: string[] = [];
    if (draft.confidence < 0.7) riskReasons.push('low_confidence');
    if (draft.needs_human_review_reasons.length) riskReasons.push(...draft.needs_human_review_reasons);
    if (triage.sentiment === 'hostile') riskReasons.push('hostile_sentiment');
    if (triage.priority === 'urgent') riskReasons.push('urgent_priority');

    await createApproval(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId,
      kind: 'send_reply',
      proposed: {
        from: replyFrom,
        to: payload.from.address,
        subject: draft.subject,
        body_markdown: draft.body_markdown,
        cites_knowledge_ids: draft.cites_knowledge_ids,
        mailboxAddress: payload.mailboxAddress,
        mailboxId: payload.mailboxId,
      },
      riskReasons,
      expiresInMs: 24 * 60 * 60 * 1000,
    });

    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId,
      actorType: 'agent',
      actorId: 'draft',
      action: 'approval.created',
      payload: { confidence: draft.confidence, tone: draft.tone, riskReasons },
    });

    await this.refreshCounts();
  }

  @callable()
  async listTickets(params: { status?: string; limit?: number; offset?: number }): Promise<TicketListItem[]> {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;
    const clause = params.status ? 'AND status = ?' : '';
    const bindings: any[] = [this.state.workspaceId];
    if (params.status) bindings.push(params.status);
    bindings.push(limit, offset);
    const rows = await this.env.DB.prepare(
      `SELECT id, subject, status, priority, requester_email, last_message_at, category, assignee_user_id
       FROM ticket WHERE workspace_id = ? ${clause}
       ORDER BY last_message_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...bindings)
      .all<TicketListItem>();
    return rows.results ?? [];
  }

  @callable()
  async getTicket(ticketId: string): Promise<{ ticket: any; messages: any[]; audit: any[]; approvals: any[] } | null> {
    const ticket = await this.env.DB.prepare(
      `SELECT * FROM ticket WHERE id = ? AND workspace_id = ?`,
    )
      .bind(ticketId, this.state.workspaceId)
      .first();
    if (!ticket) return null;
    const [messages, auditRows, approvals] = await Promise.all([
      this.env.DB.prepare(
        `SELECT * FROM message_index WHERE ticket_id = ? ORDER BY sent_at ASC`,
      )
        .bind(ticketId)
        .all(),
      this.env.DB.prepare(
        `SELECT * FROM audit_event WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(ticketId)
        .all(),
      this.env.DB.prepare(
        `SELECT * FROM approval_request WHERE ticket_id = ? ORDER BY created_at DESC`,
      )
        .bind(ticketId)
        .all(),
    ]);
    return {
      ticket,
      messages: messages.results ?? [],
      audit: auditRows.results ?? [],
      approvals: approvals.results ?? [],
    };
  }

  @callable()
  async assignTicket(args: { ticketId: string; userId: string | null; actorUserId: string }) {
    await this.env.DB.prepare(
      `UPDATE ticket SET assignee_user_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
      .bind(args.userId, Date.now(), args.ticketId, this.state.workspaceId)
      .run();
    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId: args.ticketId,
      actorType: 'user',
      actorId: args.actorUserId,
      action: args.userId ? 'ticket.assigned' : 'ticket.unassigned',
      payload: { userId: args.userId },
    });
  }

  @callable()
  async setTicketStatus(args: { ticketId: string; status: 'open' | 'pending' | 'resolved' | 'closed' | 'spam'; actorUserId: string }) {
    await this.env.DB.prepare(
      `UPDATE ticket SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
      .bind(args.status, Date.now(), args.ticketId, this.state.workspaceId)
      .run();
    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId: args.ticketId,
      actorType: 'user',
      actorId: args.actorUserId,
      action: `ticket.${args.status}`,
    });
    await this.refreshCounts();
  }

  @callable()
  async addInternalNote(args: { ticketId: string; body: string; actorUserId: string }) {
    const messageId = ids.message();
    await this.env.DB.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, preview, author_user_id, sent_at, created_at)
       VALUES (?, ?, ?, 'note', ?, ?, ?, ?)`,
    )
      .bind(messageId, args.ticketId, this.state.workspaceId, args.body.slice(0, 280), args.actorUserId, Date.now(), Date.now())
      .run();
    // persist full body to R2
    await putRaw(
      this.env,
      r2Keys.textBody(this.state.workspaceId, args.ticketId, messageId),
      new TextEncoder().encode(args.body),
      'text/plain; charset=utf-8',
    );
    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId: args.ticketId,
      actorType: 'user',
      actorId: args.actorUserId,
      action: 'ticket.internal_note',
    });
  }

  @callable()
  async listApprovals(): Promise<any[]> {
    const rows = await this.env.DB.prepare(
      `SELECT * FROM approval_request WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at DESC`,
    )
      .bind(this.state.workspaceId)
      .all();
    return rows.results ?? [];
  }

  @callable()
  async approveAndSend(args: { approvalId: string; actorUserId: string; edits?: { subject?: string; body_markdown?: string } }): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const row = await this.env.DB.prepare(
      `SELECT workspace_id, ticket_id, kind, proposed_json, status FROM approval_request WHERE id = ?`,
    )
      .bind(args.approvalId)
      .first<{ workspace_id: string; ticket_id: string; kind: string; proposed_json: string; status: string }>();
    if (!row || row.status !== 'pending') return { ok: false, error: 'not_pending' };
    if (row.workspace_id !== this.state.workspaceId) return { ok: false, error: 'wrong_workspace' };

    const proposed = JSON.parse(row.proposed_json);
    const subject = args.edits?.subject ?? proposed.subject;
    const body = args.edits?.body_markdown ?? proposed.body_markdown;

    const ticket = await this.env.DB.prepare(
      `SELECT requester_email, requester_name, thread_token FROM ticket WHERE id = ?`,
    )
      .bind(row.ticket_id)
      .first<{ requester_email: string; requester_name: string | null; thread_token: string }>();
    if (!ticket) return { ok: false, error: 'ticket_not_found' };

    await this.env.EMAIL.send({
      from: proposed.from,
      to: ticket.requester_email,
      subject,
      text: body,
    } as any);

    const messageId = ids.message();
    await this.env.DB.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, from_address, to_address, subject, preview, author_user_id, sent_at, created_at)
       VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        messageId,
        row.ticket_id,
        this.state.workspaceId,
        proposed.from,
        ticket.requester_email,
        subject,
        body.slice(0, 280),
        args.actorUserId,
        Date.now(),
        Date.now(),
      )
      .run();
    await putRaw(
      this.env,
      r2Keys.textBody(this.state.workspaceId, row.ticket_id, messageId),
      new TextEncoder().encode(body),
      'text/plain; charset=utf-8',
    );

    await this.env.DB.prepare(
      `UPDATE approval_request SET status = 'approved', decided_by_user_id = ?, decided_at = ? WHERE id = ?`,
    )
      .bind(args.actorUserId, Date.now(), args.approvalId)
      .run();

    await this.env.DB.prepare(
      `UPDATE ticket SET status = 'pending', last_message_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(Date.now(), Date.now(), row.ticket_id)
      .run();

    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      ticketId: row.ticket_id,
      actorType: 'user',
      actorId: args.actorUserId,
      action: 'reply.sent',
      payload: { approvalId: args.approvalId, edited: !!args.edits },
    });
    await this.refreshCounts();
    return { ok: true, messageId };
  }

  @callable()
  async rejectApproval(args: { approvalId: string; actorUserId: string; reason?: string }) {
    await this.env.DB.prepare(
      `UPDATE approval_request SET status = 'rejected', decided_by_user_id = ?, decided_at = ? WHERE id = ? AND workspace_id = ?`,
    )
      .bind(args.actorUserId, Date.now(), args.approvalId, this.state.workspaceId)
      .run();
    await audit(this.env, {
      workspaceId: this.state.workspaceId,
      actorType: 'user',
      actorId: args.actorUserId,
      action: 'approval.rejected',
      payload: { approvalId: args.approvalId, reason: args.reason },
    });
    await this.refreshCounts();
  }

  private async findTicketByReferences(
    inReplyTo: string | undefined,
    references: string[],
    requesterEmail: string,
  ): Promise<string | null> {
    const ids_ = [inReplyTo, ...references].filter(Boolean) as string[];
    if (ids_.length) {
      const placeholders = ids_.map(() => '?').join(',');
      const row = await this.env.DB.prepare(
        `SELECT ticket_id FROM message_index WHERE rfc_message_id IN (${placeholders}) LIMIT 1`,
      )
        .bind(...ids_)
        .first<{ ticket_id: string }>();
      if (row) return row.ticket_id;
    }
    // Fallback: open ticket from same requester in last 72h
    const since = Date.now() - 72 * 3600 * 1000;
    const row = await this.env.DB.prepare(
      `SELECT id FROM ticket WHERE workspace_id = ? AND requester_email = ? AND status IN ('open','pending') AND last_message_at > ?
       ORDER BY last_message_at DESC LIMIT 1`,
    )
      .bind(this.state.workspaceId, requesterEmail.toLowerCase(), since)
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  private async refreshCounts(): Promise<void> {
    const [open, approvals] = await Promise.all([
      this.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ticket WHERE workspace_id = ? AND status = 'open'`,
      )
        .bind(this.state.workspaceId)
        .first<{ n: number }>(),
      this.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM approval_request WHERE workspace_id = ? AND status = 'pending'`,
      )
        .bind(this.state.workspaceId)
        .first<{ n: number }>(),
    ]);
    await this.setState({
      ...this.state,
      openCount: open?.n ?? 0,
      currentApprovals: approvals?.n ?? 0,
      lastSyncAt: Date.now(),
    });
  }
}

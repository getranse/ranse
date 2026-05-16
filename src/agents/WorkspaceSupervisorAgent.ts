import { Agent, callable } from 'agents';
import type { Env } from '../env';
import type { KnowledgeInspectionHit } from '../types/knowledge';
import {
  DEFAULT_SUPERVISOR_STATE,
  type InboundEmailPayload,
  type SupervisorState,
  type TicketListItem,
} from '../types/supervisor';
import { ingestEmail as ingestInboundEmail, triageAndDraft as runTriageAndDraft } from './supervisor/email-flow';
import { makeSendThreadedReply } from './supervisor/replies';
import {
  aiDraftsEnabled,
  getAgentProfile,
  getWorkspaceSettings,
  loadWorkspaceByDOName,
  refreshCounts,
  setAgentProfile,
  setWorkspaceSettings,
  workspaceConfig,
} from './supervisor/settings';
import {
  addInternalNote,
  approveAndSend,
  assignTicket,
  draftReply,
  getTicket,
  listTickets,
  rejectApproval,
  replyDirect,
  setTicketAiDrafts,
  setTicketStatus,
} from './supervisor/ticket-actions';

export type { InboundEmailPayload, SupervisorState, TicketListItem } from '../types/supervisor';

export class WorkspaceSupervisorAgent extends Agent<Env, SupervisorState> {
  initialState: SupervisorState = DEFAULT_SUPERVISOR_STATE;

  async onStart(): Promise<void> {
    if (!this.state.workspaceId) {
      const ws = await loadWorkspaceByDOName(this.env, this.name);
      if (ws) await this.setState({ ...this.state, ...ws, lastSyncAt: Date.now() });
    }
    await this.refreshCounts();
  }

  private async refreshCounts(): Promise<void> {
    await refreshCounts(this.env, this.state, (state) => this.setState(state));
  }

  private async aiDraftsEnabled(ticketId: string): Promise<boolean> {
    return aiDraftsEnabled(this.env, this.state.workspaceId, ticketId);
  }

  private sendThreadedReply(args: Parameters<ReturnType<typeof makeSendThreadedReply>>[0]) {
    return makeSendThreadedReply(this.env, this.state.workspaceId, () => this.refreshCounts())(args);
  }

  async ingestEmail(payload: InboundEmailPayload): Promise<{ ticketId: string; messageId: string }> {
    return ingestInboundEmail({
      env: this.env,
      workspaceId: this.state.workspaceId,
      schedule: async (delay, name, scheduledPayload) => {
        await this.schedule(delay, name as any, scheduledPayload as any);
      },
      refreshCounts: () => this.refreshCounts(),
      aiDraftsEnabled: (ticketId) => this.aiDraftsEnabled(ticketId),
    }, payload);
  }

  async triageAndDraft(args: { ticketId: string; messageId: string; payload: InboundEmailPayload }) {
    return runTriageAndDraft({
      env: this.env,
      workspaceId: this.state.workspaceId,
      refreshCounts: () => this.refreshCounts(),
      workspaceConfig,
    }, args);
  }

  @callable()
  async listTickets(params: { status?: string; limit?: number; offset?: number }): Promise<TicketListItem[]> {
    return listTickets(this.env, this.state.workspaceId, params);
  }

  @callable()
  async getTicket(ticketId: string): Promise<{ ticket: any; messages: any[]; audit: any[]; approvals: any[] } | null> {
    return getTicket(this.env, this.state.workspaceId, ticketId);
  }

  @callable()
  async assignTicket(args: { ticketId: string; userId: string | null; actorUserId: string }) {
    return assignTicket(this.env, this.state.workspaceId, args);
  }

  @callable()
  async setTicketStatus(args: { ticketId: string; status: 'open' | 'pending' | 'resolved' | 'closed' | 'spam'; actorUserId: string }) {
    return setTicketStatus(this.env, this.state.workspaceId, args, () => this.refreshCounts());
  }

  @callable()
  async addInternalNote(args: { ticketId: string; body: string; actorUserId: string }) {
    return addInternalNote(this.env, this.state.workspaceId, args);
  }

  @callable()
  async approveAndSend(args: { approvalId: string; actorUserId: string; edits?: { subject?: string; body_markdown?: string } }) {
    return approveAndSend(this.env, this.state.workspaceId, args, (replyArgs) => this.sendThreadedReply(replyArgs));
  }

  @callable()
  async replyDirect(args: {
    ticketId: string;
    actorUserId: string;
    body: string;
    subject?: string;
    citedKnowledgeIds?: string[];
  }) {
    return replyDirect(this.env, this.state.workspaceId, args, (replyArgs) => this.sendThreadedReply(replyArgs));
  }

  @callable()
  async draftReply(args: {
    ticketId: string;
    actorUserId: string;
  }): Promise<{ ok: boolean; subject?: string; body?: string; knowledge?: KnowledgeInspectionHit[]; error?: string }> {
    return draftReply(this.env, this.state.workspaceId, args, workspaceConfig);
  }

  @callable()
  async setTicketAiDrafts(args: {
    ticketId: string;
    actorUserId: string;
    enabled: boolean | null;
  }): Promise<{ ok: boolean }> {
    return setTicketAiDrafts(this.env, this.state.workspaceId, args);
  }

  @callable()
  async getWorkspaceSettings() {
    return getWorkspaceSettings(this.env, this.state.workspaceId);
  }

  @callable()
  async setWorkspaceSettings(args: {
    actorUserId: string;
    ai_drafts_enabled?: boolean;
    from_name?: string;
    logo_url?: string;
  }): Promise<{ ok: boolean }> {
    return setWorkspaceSettings(this.env, this.state.workspaceId, args);
  }

  @callable()
  async getAgentProfile(args: { userId: string }) {
    return getAgentProfile(this.env, this.state.workspaceId, args.userId);
  }

  @callable()
  async setAgentProfile(args: {
    userId: string;
    name?: string;
    signature_markdown?: string;
    avatar_url?: string;
  }): Promise<{ ok: boolean }> {
    return setAgentProfile(this.env, args);
  }

  @callable()
  async rejectApproval(args: { approvalId: string; actorUserId: string; reason?: string }) {
    return rejectApproval(this.env, this.state.workspaceId, args, () => this.refreshCounts());
  }
}

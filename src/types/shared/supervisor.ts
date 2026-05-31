import type { SupervisorState, InboundEmailPayload, TicketListItem } from '../../interfaces/supervisor';
export type { SupervisorState, InboundEmailPayload, TicketListItem };


export const DEFAULT_SUPERVISOR_STATE: SupervisorState = {
  workspaceId: '',
  workspaceName: '',
  openCount: 0,
  lastSyncAt: 0,
  currentApprovals: 0,
  presence: {},
};

export type SendThreadedReply = (args: {
  ticketId: string;
  body: string;
  subject?: string;
  actorUserId: string | null;
  source: 'manual' | 'ai_approval' | 'ai_autonomous' | 'procedure';
  approvalId?: string;
  edited?: boolean;
}) => Promise<{ messageId: string }>;

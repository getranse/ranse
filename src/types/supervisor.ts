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
  source: 'manual' | 'ai_approval';
  approvalId?: string;
  edited?: boolean;
}) => Promise<{ messageId: string }>;

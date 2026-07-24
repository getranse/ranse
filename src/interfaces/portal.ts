export interface PortalTokenPayload {
  workspaceId: string;
  ticketId: string;
  expiresAt: number;
}

export interface PortalMessage {
  direction: 'inbound' | 'outbound';
  preview: string | null;
  sent_at: number;
}

export interface PortalTicketView {
  subject: string;
  status: string;
  workspace_name: string;
  messages: PortalMessage[];
}

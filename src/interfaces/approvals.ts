export interface ApprovalInput {
  workspaceId: string;
  ticketId: string;
  kind: 'send_reply' | 'close_ticket' | 'run_macro' | 'call_external';
  proposed: Record<string, unknown>;
  riskReasons: string[];
  expiresInMs?: number;
}

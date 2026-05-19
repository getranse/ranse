export type PublicChannelKind = 'chat' | 'form';

export interface PublicChannel {
  id: string;
  workspace_id: string;
  mailbox_id: string;
  mailbox_address?: string;
  kind: PublicChannelKind;
  name: string;
  public_key: string;
  enabled: number;
  require_email: number;
  allowed_origins_json: string;
  welcome_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface PublicChannelConfig {
  key: string;
  kind: PublicChannelKind;
  name: string;
  require_email: boolean;
  welcome_message: string | null;
}

export interface PublicConversationSession {
  id: string;
  workspace_id: string;
  channel_id: string;
  ticket_id: string;
  session_token_hash: string;
  requester_email: string;
  requester_name: string | null;
  visitor_id: string | null;
  origin: string | null;
  user_agent: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
  closed_at: number | null;
}

export interface PublicSessionMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  preview: string | null;
  body: string | null;
  from_address: string | null;
  to_address: string | null;
  sent_at: number;
}

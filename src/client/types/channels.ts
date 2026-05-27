import type { PublicChannel, PublicChannelKind } from '../../types/channels';

export type PublicChannelEntry = PublicChannel;

export interface PublicChannelInput {
  kind: PublicChannelKind;
  mailbox_id: string;
  name: string;
  enabled?: boolean;
  require_email?: boolean;
  allowed_origins?: string[];
  welcome_message?: string | null;
  config?: Record<string, unknown>;
  sla_first_response_minutes?: number | null;
  sla_resolution_minutes?: number | null;
  default_priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
  default_assignee_user_id?: string | null;
}

export type PublicChannelUpdate = Partial<Omit<PublicChannelInput, 'kind' | 'mailbox_id'>>;

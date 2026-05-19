import type { ChannelKind } from './channels';

// Omnichannel notification cascade. An operator (or procedure) calls
// `notifyCustomer` with a template + payload; the engine materializes a
// `NotificationPlan` plus per-channel `NotificationStep` rows, schedules
// the first step, and advances based on provider delivery receipts.

export type NotificationUrgency = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationPlanStatus = 'pending' | 'active' | 'completed' | 'cancelled' | 'failed';

export type NotificationStepStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export type NotificationStepTrigger =
  | 'immediate'
  | 'previous_failed'
  | 'previous_unread'
  | 'previous_no_ack'
  | 'time_elapsed';

export type NotificationDeliveryEventKind =
  | 'sent'
  | 'delivered'
  | 'read'
  | 'clicked'
  | 'replied'
  | 'failed';

export interface NotificationTemplate {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string | null;
  default_channels_json: string;
  bodies_json: string;
  metadata_json: string;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface NotificationPlan {
  id: string;
  workspace_id: string;
  customer_id: string;
  ticket_id: string | null;
  template_id: string | null;
  template_slug: string | null;
  urgency: NotificationUrgency;
  status: NotificationPlanStatus;
  payload_json: string;
  acknowledged_at: number | null;
  completed_at: number | null;
  cancelled_reason: string | null;
  created_by_user_id: string | null;
  source: 'api' | 'procedure' | 'operator';
  created_at: number;
  updated_at: number;
}

export interface NotificationStep {
  id: string;
  workspace_id: string;
  plan_id: string;
  sequence: number;
  channel_kind: ChannelKind;
  channel_id: string | null;
  trigger_on: NotificationStepTrigger;
  delay_ms: number;
  status: NotificationStepStatus;
  scheduled_at: number | null;
  attempted_at: number | null;
  delivered_at: number | null;
  read_at: number | null;
  acknowledged_at: number | null;
  external_id: string | null;
  last_error: string | null;
  body_text: string | null;
  body_html: string | null;
  body_json: string | null;
}

export interface NotificationDeliveryEvent {
  id: string;
  workspace_id: string;
  step_id: string;
  kind: NotificationDeliveryEventKind;
  occurred_at: number;
  payload_json: string;
}

// Inputs to `notifyCustomer`. `cascade` is the per-call override of the
// template's default channel sequence — gives procedures full control.
export interface CascadeStepInput {
  channelKind: ChannelKind;
  channelId?: string | null;
  triggerOn?: NotificationStepTrigger;
  delayMs?: number;
  body?: {
    text?: string;
    html?: string;
    json?: Record<string, unknown>;
  };
}

export interface NotifyCustomerInput {
  workspaceId: string;
  customerId: string;
  ticketId?: string | null;
  templateSlug?: string;
  payload?: Record<string, unknown>;
  urgency?: NotificationUrgency;
  cascade?: CascadeStepInput[];
  createdByUserId?: string | null;
  source?: NotificationPlan['source'];
}

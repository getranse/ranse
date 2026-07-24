import type { ChannelKind } from '../types/shared/channels';
import type {
  NotificationDeliveryEventKind,
  NotificationPlanStatus,
  NotificationStepStatus,
  NotificationStepTrigger,
  NotificationUrgency,
} from '../types/shared/notifications';
export type ChannelPreferenceStatus = 'enabled' | 'disabled';

export interface InsertPlanInput {
  workspaceId: string;
  customerId: string;
  ticketId: string | null;
  templateId: string | null;
  templateSlug: string | null;
  urgency: NotificationPlan['urgency'];
  payload: Record<string, unknown>;
  createdByUserId: string | null;
  source: NotificationPlan['source'];
}

export interface InsertStepInput {
  workspaceId: string;
  planId: string;
  sequence: number;
  channelKind: string;
  channelId: string | null;
  triggerOn: NotificationStepTrigger;
  delayMs: number;
  scheduledAt: number | null;
  bodyText: string | null;
  bodyHtml: string | null;
  bodyJson: string | null;
}

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
}

export interface ChannelRow {
  id: string;
  kind: string;
  target: string;
  events: string;
}

export interface ChannelPreference {
  workspace_id: string;
  customer_id: string;
  channel_kind: ChannelKind;
  status: ChannelPreferenceStatus;
  quiet_hours_start_minutes: number | null;
  quiet_hours_end_minutes: number | null;
  timezone: string | null;
  consent_source: string | null;
  consent_at: number | null;
  updated_at: number;
}

export interface PreferenceCheck {
  allowed: boolean;
  reason?: 'opted_out' | 'quiet_hours';
  retryAfterMs?: number;
}

export interface NotificationMeta {
  events: { name: string; description: string }[];
  channels: {
    kind: string;
    label: string;
    description: string;
    targetLabel: string;
    targetPlaceholder: string;
  }[];
}

export interface NotificationChannel {
  id: string;
  kind: string;
  target: string;
  events: string[];
  enabled: boolean;
  label: string | null;
  created_at: number;
}

export interface NotificationChannelInput {
  kind: string;
  target: string;
  events: string[];
  label?: string;
}

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

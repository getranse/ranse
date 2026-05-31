import type { NotificationTemplate, NotificationPlan, NotificationStep, NotificationDeliveryEvent, CascadeStepInput, NotifyCustomerInput } from '../../interfaces/notifications';
export type { NotificationTemplate, NotificationPlan, NotificationStep, NotificationDeliveryEvent, CascadeStepInput, NotifyCustomerInput };

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

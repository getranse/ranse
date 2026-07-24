export interface WebhookDeliveryMessage {
  url: string;
  signature: string;
  payload: unknown;
}

export interface SLABreachAuditPayload {
  first_response_breached: boolean;
  resolution_breached: boolean;
  priority: string;
  due_at: number;
}

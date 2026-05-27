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

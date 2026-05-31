

export interface SendingSubdomain {
  tag: string;
  name: string;
  enabled?: boolean;
  dkim_selector?: string;
}

export interface SendingDnsRecord {
  type: string;
  name: string;
  content: string;
  priority?: number;
  reason?: string;
}

export interface ProvisionStep {
  id: string;
  label: string;
  status: 'ok' | 'fail' | 'skipped';
  message?: string;
  dns_records?: SendingDnsRecord[];
  actions?: Array<{ url: string; label: string }>;
}

export interface ProvisionInput {
  apiToken: string;
  accountId: string;
  domain: string;
  mailboxAddress: string;
  workerName: string;
}

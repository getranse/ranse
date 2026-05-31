

export interface ProvisionInput {
  api_token: string;
  account_id: string;
  domain: string;
  mailbox_address: string;
  worker_name: string;
}

export interface AdminForm {
  setup_token: string;
  workspace_name: string;
  admin_name: string;
  admin_email: string;
  admin_password: string;
}

export interface MailboxForm {
  address: string;
  display_name: string;
}

export interface ProvisionForm {
  enabled: boolean;
  api_token: string;
  account_id: string;
  worker_name: string;
}

export interface SetupChecks {
  checks: Record<string, { ok: boolean; message?: string }>;
}

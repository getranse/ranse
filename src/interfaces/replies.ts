export interface SignatureCtx {
  agentName?: string | null;
  agentEmail?: string | null;
  agentSignatureMarkdown?: string | null;
  agentAvatarUrl?: string | null;
  workspaceName?: string | null;
  fromName?: string | null;
  /** True when no human authored the reply (autonomy/procedure path) — adds the AI disclosure footer. */
  aiAuthored?: boolean;
}

export interface EmailFeedbackLinks {
  positive: string;
  negative: string;
  portal?: string;
}

export interface ReplyBodyCtx {
  workspace_settings: string;
  workspace_name: string;
}

export interface ReplyAgent {
  name: string | null;
  email: string;
  signature_markdown: string | null;
  avatar_url: string | null;
}

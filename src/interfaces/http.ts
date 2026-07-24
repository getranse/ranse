import type { WorkspaceRole } from '../types/shared/workspace';

export interface AuthedSession {
  sessionId: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

export interface ApiTokenRecord {
  id: string;
  name: string;
  token_prefix: string;
  role: 'admin' | 'agent' | 'viewer';
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface ResolvedApiToken {
  tokenId: string;
  workspaceId: string;
  role: 'admin' | 'agent' | 'viewer';
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: number;
}

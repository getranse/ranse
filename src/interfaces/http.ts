import type { WorkspaceRole } from '../types/shared/workspace';

export interface AuthedSession {
  sessionId: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

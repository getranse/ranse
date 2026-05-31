import { getAgentByName } from 'agents';
import type { Env } from '../../env';
import type { McpServer } from '../../../types/shared/mcp';

export async function getMcpAuthSecret(
  env: Env,
  workspaceId: string,
  server: Pick<McpServer, 'auth_type' | 'secret_ref'>,
): Promise<string | null> {
  if (server.auth_type === 'none') return null;
  if (!server.secret_ref) throw new Error('mcp_auth_secret_missing');
  const stub = await getAgentByName(env.UserSecretsStore as never, workspaceId);
  return (stub as any).getKey(server.secret_ref);
}

export async function setMcpAuthSecret(
  env: Env,
  workspaceId: string,
  secretRef: string | null,
  secret: string | undefined,
): Promise<void> {
  if (!secretRef || !secret) return;
  const stub = await getAgentByName(env.UserSecretsStore as never, workspaceId);
  await (stub as any).setKey({ provider: secretRef, apiKey: secret });
}

export async function deleteMcpAuthSecret(
  env: Env,
  workspaceId: string,
  secretRef: string | null,
): Promise<void> {
  if (!secretRef) return;
  const stub = await getAgentByName(env.UserSecretsStore as never, workspaceId);
  await (stub as any).deleteKey(secretRef);
}

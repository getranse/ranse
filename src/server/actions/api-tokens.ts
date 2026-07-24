import type { ApiTokenRecord, ResolvedApiToken } from '../../interfaces/http';
import { randomToken, sha256Hex } from '../../lib/crypto';
import { ids } from '../../lib/ids';
import type { Env } from '../env';

const TOKEN_PREFIX = 'ranse_';

/** Create a token; the raw value is returned exactly once and never stored. */
export async function createApiToken(
  env: Env,
  args: {
    workspaceId: string;
    name: string;
    role: 'admin' | 'agent' | 'viewer';
    createdBy: string;
  },
): Promise<{ token: string; record: ApiTokenRecord }> {
  const raw = `${TOKEN_PREFIX}${randomToken(24)}`;
  const record: ApiTokenRecord = {
    id: ids.message(),
    name: args.name,
    token_prefix: raw.slice(0, TOKEN_PREFIX.length + 6),
    role: args.role,
    created_at: Date.now(),
    last_used_at: null,
    revoked_at: null,
  };
  await env.DB.prepare(
    `INSERT INTO api_token (id, workspace_id, name, token_hash, token_prefix, role, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      record.id,
      args.workspaceId,
      record.name,
      await sha256Hex(raw),
      record.token_prefix,
      record.role,
      args.createdBy,
      record.created_at,
    )
    .run();
  return { token: raw, record };
}

export async function listApiTokens(env: Env, workspaceId: string): Promise<ApiTokenRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, token_prefix, role, created_at, last_used_at, revoked_at
       FROM api_token WHERE workspace_id = ? ORDER BY created_at DESC`,
  )
    .bind(workspaceId)
    .all<ApiTokenRecord>();
  return rows.results ?? [];
}

export async function revokeApiToken(
  env: Env,
  workspaceId: string,
  tokenId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE api_token SET revoked_at = ? WHERE workspace_id = ? AND id = ? AND revoked_at IS NULL`,
  )
    .bind(Date.now(), workspaceId, tokenId)
    .run();
}

/** Bearer value → workspace/role, or null for unknown/revoked tokens. */
export async function resolveApiToken(env: Env, bearer: string): Promise<ResolvedApiToken | null> {
  if (!bearer.startsWith(TOKEN_PREFIX)) return null;
  const row = await env.DB.prepare(
    `SELECT id, workspace_id, role FROM api_token WHERE token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(await sha256Hex(bearer))
    .first<{ id: string; workspace_id: string; role: ResolvedApiToken['role'] }>();
  if (!row) return null;
  await env.DB.prepare(`UPDATE api_token SET last_used_at = ? WHERE id = ?`)
    .bind(Date.now(), row.id)
    .run();
  return { tokenId: row.id, workspaceId: row.workspace_id, role: row.role };
}

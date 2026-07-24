import type { Env } from '../env';

/**
 * Purge audit events older than the configured retention window. Set
 * AUDIT_RETENTION_DAYS to a positive number of days; 0 or unset keeps events
 * forever. Only an old prefix is ever removed, so verifyAuditChain still
 * validates the retained suffix. retentionDays: 0 in the result means
 * retention is off — never report a default that isn't being applied.
 */
export async function runAuditRetentionSweep(
  env: Env,
): Promise<{ deleted: number; retentionDays: number }> {
  const configured = Number(
    (env as unknown as { AUDIT_RETENTION_DAYS?: string }).AUDIT_RETENTION_DAYS,
  );
  const retentionDays = Number.isFinite(configured) && configured > 0 ? configured : 0;
  if (retentionDays <= 0) return { deleted: 0, retentionDays: 0 };
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = await env.DB.prepare(`DELETE FROM audit_event WHERE created_at < ?`)
    .bind(cutoff)
    .run();
  return { deleted: Number(result.meta?.changes ?? 0), retentionDays };
}

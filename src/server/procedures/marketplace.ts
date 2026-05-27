import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { ids } from '../lib/ids';
import { audit } from '../lib/audit';
import {
  MARKETPLACE_MANIFEST_SCHEMA,
  type MarketplaceEntry,
  type MarketplaceInstall,
  type MarketplaceInstallSummary,
  type MarketplaceManifest,
} from '../../types/marketplace';
import { PROCEDURE_LIBRARY } from './library-data';
import {
  PROCEDURE_LIBRARY_STANDARDS,
  PROCEDURE_LIBRARY_VERSION,
} from './library';
import { normalizeProcedureSpec, stableStringify } from './schema';
import { upsertProcedureVersion } from './storage';
import { runProcedureSpecEvals } from '../evals/replay';

// Public procedure marketplace. The marketplace turns the in-tree procedure
// library into a manifest that anyone can mirror at procedures.ranse.dev (or
// host themselves). Installs persist parent fingerprint + version so we can
// flag updates and prove provenance.

export async function exportMarketplaceManifest(
  options: { sourceRepo?: string; generatedAt?: string } = {},
): Promise<MarketplaceManifest> {
  const entries = await Promise.all(
    PROCEDURE_LIBRARY.map((item) => marketplaceEntryFromItem(item)),
  );
  return {
    manifest_version: MARKETPLACE_MANIFEST_SCHEMA,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    source_repo: options.sourceRepo ?? 'getranse/ranse',
    procedures: entries,
  };
}

async function marketplaceEntryFromItem(item: typeof PROCEDURE_LIBRARY[number]): Promise<MarketplaceEntry> {
  const spec = normalizeProcedureSpec(item.spec);
  const fingerprint = await sha256Hex(stableStringify(spec));
  const evalReport = runProcedureSpecEvals(spec);
  return {
    slug: item.slug,
    name: item.name,
    summary: item.summary,
    category: item.category,
    tags: [...item.tags],
    risk_level: item.risk_level,
    version: item.version,
    required_mcp_servers: [...item.required_mcp_servers],
    reference_mcp_tools: item.reference_mcp_tools,
    spec_checksum: fingerprint,
    spec_inline: spec,
    author: 'ranse-library',
    homepage: 'https://procedures.ranse.dev',
    license: 'Apache-2.0',
    eval_pass_rate:
      evalReport.case_count > 0 ? evalReport.passed_count / evalReport.case_count : undefined,
  };
}

export async function installFromManifestEntry(
  env: Env,
  input: {
    workspaceId: string;
    actorUserId: string;
    entry: MarketplaceEntry;
    sourceManifestUrl?: string;
    sourceAuthor?: string;
    sourceRepo?: string;
  },
): Promise<MarketplaceInstall> {
  if (!input.entry.spec_inline) {
    throw new Error('marketplace_entry_missing_spec');
  }
  const spec = normalizeProcedureSpec(input.entry.spec_inline);
  const fingerprint = await sha256Hex(stableStringify(spec));
  if (fingerprint !== input.entry.spec_checksum) {
    throw new Error('marketplace_entry_checksum_mismatch');
  }
  const evalReport = runProcedureSpecEvals(spec);
  if (evalReport.status === 'failed') {
    throw new Error('marketplace_entry_evals_failed');
  }
  const upsert = await upsertProcedureVersion(env, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    spec,
    sourceKind: 'seed',
    sourceRef:
      input.sourceManifestUrl ??
      `marketplace:${input.entry.slug}@${input.entry.version}#sha256:${fingerprint}`,
  });
  const id = ids.marketplaceInstall();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO procedure_marketplace_install (
       id, workspace_id, slug, source_manifest_url, source_author, source_repo,
       parent_fingerprint, forked_version, installed_at, installed_by, procedure_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.entry.slug,
      input.sourceManifestUrl ?? null,
      input.sourceAuthor ?? null,
      input.sourceRepo ?? null,
      fingerprint,
      input.entry.version,
      now,
      input.actorUserId ?? null,
      upsert.procedure.id,
    )
    .run();
  await audit(env, {
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorId: input.actorUserId,
    action: 'marketplace.install',
    payload: {
      slug: input.entry.slug,
      version: input.entry.version,
      fingerprint,
      source_manifest_url: input.sourceManifestUrl,
    },
  });
  return {
    id,
    workspace_id: input.workspaceId,
    slug: input.entry.slug,
    source_manifest_url: input.sourceManifestUrl ?? null,
    source_author: input.sourceAuthor ?? null,
    source_repo: input.sourceRepo ?? null,
    parent_fingerprint: fingerprint,
    forked_version: input.entry.version,
    installed_at: now,
    installed_by: input.actorUserId ?? null,
    procedure_id: upsert.procedure.id,
    update_available_version: null,
    update_available_fingerprint: null,
    update_checked_at: null,
  };
}

export async function listMarketplaceInstalls(
  env: Env,
  workspaceId: string,
): Promise<MarketplaceInstallSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT id, workspace_id, slug, source_manifest_url, source_author, source_repo,
            parent_fingerprint, forked_version, installed_at, installed_by, procedure_id,
            update_available_version, update_available_fingerprint, update_checked_at
       FROM procedure_marketplace_install
      WHERE workspace_id = ?
      ORDER BY installed_at DESC`,
  )
    .bind(workspaceId)
    .all<MarketplaceInstall>();
  return rows.results ?? [];
}

export interface CheckForUpdatesResult {
  slug: string;
  status: 'current' | 'update_available' | 'unknown';
  forked_version: string;
  current_version?: string;
  current_fingerprint?: string;
}

export async function checkForUpdates(
  env: Env,
  workspaceId: string,
  options: { manifest?: MarketplaceManifest } = {},
): Promise<CheckForUpdatesResult[]> {
  const installs = await listMarketplaceInstalls(env, workspaceId);
  const manifest = options.manifest ?? (await exportMarketplaceManifest());
  const bySlug = new Map(manifest.procedures.map((p) => [p.slug, p] as const));
  const now = Date.now();
  const results: CheckForUpdatesResult[] = [];
  for (const install of installs) {
    const entry = bySlug.get(install.slug);
    if (!entry) {
      results.push({
        slug: install.slug,
        status: 'unknown',
        forked_version: install.forked_version,
      });
      continue;
    }
    const status: CheckForUpdatesResult['status'] =
      entry.spec_checksum === install.parent_fingerprint ? 'current' : 'update_available';
    await env.DB.prepare(
      `UPDATE procedure_marketplace_install
          SET update_available_version = ?,
              update_available_fingerprint = ?,
              update_checked_at = ?
        WHERE id = ?`,
    )
      .bind(
        status === 'update_available' ? entry.version : null,
        status === 'update_available' ? entry.spec_checksum : null,
        now,
        install.id,
      )
      .run();
    results.push({
      slug: install.slug,
      status,
      forked_version: install.forked_version,
      current_version: entry.version,
      current_fingerprint: entry.spec_checksum,
    });
  }
  return results;
}

export const MARKETPLACE_STANDARDS = {
  ...PROCEDURE_LIBRARY_STANDARDS,
  manifest_schema: MARKETPLACE_MANIFEST_SCHEMA,
  library_version: PROCEDURE_LIBRARY_VERSION,
};

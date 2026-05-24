import { describe, expect, it } from 'vitest';
import {
  checkForUpdates,
  exportMarketplaceManifest,
  installFromManifestEntry,
  listMarketplaceInstalls,
} from '../src/procedures/marketplace';
import { MARKETPLACE_MANIFEST_SCHEMA } from '../src/types/marketplace';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

describe('procedure marketplace', () => {
  it('exports a manifest of the in-tree procedure library', async () => {
    const manifest = await exportMarketplaceManifest({
      sourceRepo: 'getranse/ranse',
      generatedAt: '2026-05-19T00:00:00.000Z',
    });
    expect(manifest.manifest_version).toBe(MARKETPLACE_MANIFEST_SCHEMA);
    expect(manifest.source_repo).toBe('getranse/ranse');
    expect(manifest.procedures.length).toBeGreaterThan(20);
    for (const proc of manifest.procedures) {
      expect(proc.spec_checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(proc.spec_inline).toBeDefined();
      expect(proc.slug.length).toBeGreaterThan(0);
    }
    // Within a single export, every slug is unique and every checksum is
    // workspace-installable.
    const slugs = manifest.procedures.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('round-trips an install from manifest entry with attribution', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const manifest = await exportMarketplaceManifest();
    const entry = manifest.procedures.find((p) => p.slug === 'refund-intake');
    expect(entry).toBeDefined();
    const install = await installFromManifestEntry(env as any, {
      workspaceId: 'ws_a',
      actorUserId: 'usr_1',
      entry: entry!,
      sourceManifestUrl: 'https://procedures.ranse.dev/manifest.json',
      sourceAuthor: 'ranse-library',
      sourceRepo: 'getranse/ranse',
    });
    expect(install.parent_fingerprint).toBe(entry!.spec_checksum);
    expect(install.forked_version).toBe(entry!.version);
    expect(install.procedure_id).toBeTruthy();
    const list = await listMarketplaceInstalls(env as any, 'ws_a');
    expect(list).toHaveLength(1);
    expect(list[0].source_author).toBe('ranse-library');
    expect(list[0].source_manifest_url).toBe('https://procedures.ranse.dev/manifest.json');
  });

  it('rejects a tampered manifest entry by checksum', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const manifest = await exportMarketplaceManifest();
    const entry = { ...manifest.procedures[0] };
    entry.spec_checksum = 'a'.repeat(64);
    await expect(
      installFromManifestEntry(env as any, {
        workspaceId: 'ws_a',
        actorUserId: 'usr_1',
        entry,
      }),
    ).rejects.toThrow('marketplace_entry_checksum_mismatch');
  });

  it('marks installs current when manifest fingerprint matches', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const manifest = await exportMarketplaceManifest();
    const entry = manifest.procedures.find((p) => p.slug === 'refund-intake')!;
    await installFromManifestEntry(env as any, {
      workspaceId: 'ws_a',
      actorUserId: 'usr_1',
      entry,
    });
    const updates = await checkForUpdates(env as any, 'ws_a', { manifest });
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('current');
  });

  it('flags installs as update_available when fingerprint drifts', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const manifest = await exportMarketplaceManifest();
    const entry = manifest.procedures.find((p) => p.slug === 'refund-intake')!;
    await installFromManifestEntry(env as any, {
      workspaceId: 'ws_a',
      actorUserId: 'usr_1',
      entry,
    });
    // Mutate the manifest entry as if upstream advanced.
    const newer = {
      ...manifest,
      procedures: manifest.procedures.map((p) =>
        p.slug === 'refund-intake' ? { ...p, version: '1.1.0', spec_checksum: 'b'.repeat(64) } : p,
      ),
    };
    const updates = await checkForUpdates(env as any, 'ws_a', { manifest: newer });
    const refund = updates.find((u) => u.slug === 'refund-intake');
    expect(refund?.status).toBe('update_available');
    expect(refund?.current_version).toBe('1.1.0');
  });
});

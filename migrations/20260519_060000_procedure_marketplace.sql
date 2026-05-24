-- Public procedure marketplace. Phase 7 ships a local, built-in procedure
-- library. Phase 11 adds the public registry: a workspace can install a
-- procedure from a published manifest, track which upstream version it
-- forked, and check for updates.
--
-- The install record is the audit + attribution surface: every fork carries
-- the parent_fingerprint (sha256 of the upstream spec) so updates are
-- diffable and provenance is preserved across forks.

CREATE TABLE IF NOT EXISTS procedure_marketplace_install (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  source_manifest_url TEXT,
  source_author TEXT,
  source_repo TEXT,
  parent_fingerprint TEXT NOT NULL,
  forked_version TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  installed_by TEXT,
  procedure_id TEXT,
  update_available_version TEXT,
  update_available_fingerprint TEXT,
  update_checked_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marketplace_install_workspace
  ON procedure_marketplace_install(workspace_id, installed_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_install_slug
  ON procedure_marketplace_install(workspace_id, slug);

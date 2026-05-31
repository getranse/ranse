#!/usr/bin/env bun
// Marketplace manifest exporter. Run from the repo root:
//
//   bun scripts/marketplace-export.ts > marketplace.json
//
// Produces a procedures.ranse.dev-compatible manifest of every shipped
// procedure with stable SHA-256 fingerprints. Used by the public registry
// publish pipeline and by `ranse procedure publish`.

import { exportMarketplaceManifest } from '../src/server/automation/procedures/marketplace';

async function main() {
  const sourceRepo = process.env.RANSE_MARKETPLACE_REPO ?? 'getranse/ranse';
  const manifest = await exportMarketplaceManifest({ sourceRepo });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

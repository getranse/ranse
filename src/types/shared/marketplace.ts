import type { MarketplaceManifest, MarketplaceEntry, MarketplaceInstall, MarketplaceInstallSummary } from '../../interfaces/marketplace';
export type { MarketplaceManifest, MarketplaceEntry, MarketplaceInstall, MarketplaceInstallSummary };
// Public procedure marketplace types. A manifest entry is the public
// description of a procedure published to procedures.ranse.dev (or any
// compatible mirror); the install record is the local row tracking what a
// workspace forked and from where.


export const MARKETPLACE_MANIFEST_SCHEMA = 'ranse.marketplace.v1';

import type { MARKETPLACE_MANIFEST_SCHEMA } from '../types/shared/marketplace';
import type {
  ProcedureLibraryCategory,
  ProcedureLibraryMcpToolSpec,
  ProcedureLibraryReadiness,
  ProcedureSpec,
} from '../types/shared/procedures';

export interface MarketplaceManifest {
  manifest_version: typeof MARKETPLACE_MANIFEST_SCHEMA;
  generated_at: string;
  source_repo: string;
  procedures: MarketplaceEntry[];
}

export interface MarketplaceEntry {
  slug: string;
  name: string;
  summary: string;
  category: ProcedureLibraryCategory;
  tags: string[];
  risk_level: 'low' | 'medium' | 'high';
  version: string;
  required_mcp_servers: string[];
  reference_mcp_tools: ProcedureLibraryMcpToolSpec[];
  spec_checksum: string;
  spec_url?: string;
  spec_inline?: ProcedureSpec;
  author?: string;
  homepage?: string;
  license?: string;
  eval_pass_rate?: number;
}

export interface MarketplaceInstall {
  id: string;
  workspace_id: string;
  slug: string;
  source_manifest_url: string | null;
  source_author: string | null;
  source_repo: string | null;
  parent_fingerprint: string;
  forked_version: string;
  installed_at: number;
  installed_by: string | null;
  procedure_id: string | null;
  update_available_version: string | null;
  update_available_fingerprint: string | null;
  update_checked_at: number | null;
}

export interface MarketplaceInstallSummary extends MarketplaceInstall {
  readiness?: ProcedureLibraryReadiness;
  current_marketplace_version?: string;
  current_marketplace_fingerprint?: string;
}

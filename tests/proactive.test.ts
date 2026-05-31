import { describe, expect, it } from 'vitest';
import {
  acceptProposal,
  discoverProposals,
  listProposals,
  rejectProposal,
} from '../src/server/platform/insights/proactive';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function seedSuggestion(
  db: any,
  workspaceId: string,
  clusterKey: string,
  options: {
    title?: string;
    summary?: string;
    body?: string;
    ticketIds?: string[];
    terms?: string[];
    status?: 'open' | 'accepted' | 'dismissed';
  } = {},
) {
  const id = `kb_sug_${clusterKey}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO kb_suggestion (
      id, workspace_id, cluster_key, title, summary, body_markdown,
      source_ticket_ids_json, suggested_terms_json, evidence_count,
      confidence_score, status, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved_cluster', ?, ?)`,
  ).run(
    id,
    workspaceId,
    clusterKey,
    options.title ?? 'Refund window confusion',
    options.summary ?? '3 customers asked the same question',
    options.body ?? '# Suggested KB article body',
    JSON.stringify(options.ticketIds ?? ['tkt_1', 'tkt_2', 'tkt_3']),
    JSON.stringify(options.terms ?? ['refund', 'window', '30 day']),
    options.ticketIds?.length ?? 3,
    0.8,
    options.status ?? 'open',
    now,
    now,
  );
}

describe('proactive resolution loop', () => {
  it('drafts a proposal from an open KB suggestion', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedSuggestion(db, 'ws_a', 'refund_window');
    const result = await discoverProposals(env as any, 'ws_a');
    expect(result.examined).toBe(1);
    expect(result.drafted).toBeGreaterThanOrEqual(1);
    const proposals = await listProposals(env as any, 'ws_a');
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal.status).toBe('pending');
    expect(proposal.kind).toBe('combined');
    expect(proposal.draft_procedure_spec_json).not.toBeNull();
    expect(proposal.draft_knowledge_entry_json).not.toBeNull();
    // Evidence ticket ids preserved.
    expect(JSON.parse(proposal.evidence_ticket_ids_json!)).toEqual([
      'tkt_1',
      'tkt_2',
      'tkt_3',
    ]);
  });

  it('is idempotent — re-discovering the same cluster does not create duplicates', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedSuggestion(db, 'ws_a', 'refund_window');
    await discoverProposals(env as any, 'ws_a');
    await discoverProposals(env as any, 'ws_a');
    const proposals = await listProposals(env as any, 'ws_a');
    expect(proposals).toHaveLength(1);
  });

  it('accepts a pending proposal and publishes a procedure version', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedSuggestion(db, 'ws_a', 'refund_window');
    const discovered = await discoverProposals(env as any, 'ws_a');
    const id = discovered.proposalIds[0];
    const accepted = await acceptProposal(env as any, 'ws_a', id, 'usr_1');
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.applied_procedure_id).toBeTruthy();
    const proc = db
      .prepare(
        `SELECT slug, name FROM procedure WHERE id = ? AND workspace_id = 'ws_a'`,
      )
      .get(accepted!.applied_procedure_id!) as any;
    expect(proc).toBeDefined();
    expect(proc.slug).toMatch(/^proactive-/);
  });

  it('rejects a pending proposal with a reason', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedSuggestion(db, 'ws_a', 'refund_window');
    const discovered = await discoverProposals(env as any, 'ws_a');
    const id = discovered.proposalIds[0];
    const rejected = await rejectProposal(env as any, 'ws_a', id, 'usr_1', 'wrong intent');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejected_reason).toBe('wrong intent');
  });

  it('refuses to accept a non-pending proposal', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedSuggestion(db, 'ws_a', 'refund_window');
    const discovered = await discoverProposals(env as any, 'ws_a');
    const id = discovered.proposalIds[0];
    await rejectProposal(env as any, 'ws_a', id, 'usr_1', 'wrong');
    await expect(acceptProposal(env as any, 'ws_a', id, 'usr_1')).rejects.toThrow(
      'proactive_proposal_not_pending',
    );
  });
});

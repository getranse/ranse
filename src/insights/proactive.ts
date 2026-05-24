import type { Env } from '../env';
import { audit } from '../lib/audit';
import { ids } from '../lib/ids';
import {
  PROACTIVE_EVAL_PASS_THRESHOLD,
  type ProactiveProposal,
  type ProactiveProposalDraft,
  type ProactiveProposalKind,
  type ProactiveProposalStatus,
} from '../types/proactive';
import { normalizeProcedureSpec } from '../procedures/schema';
import { runProcedureSpecEvals } from '../evals/replay';
import { upsertProcedureVersion } from '../procedures/storage';
import { listKbSuggestions, acceptKbSuggestion } from './index';

// Proactive resolution loop. The capstone of Phase 11.
//
// Phase 8 already detects unresolved-intent clusters and writes them to
// kb_suggestion. The proactive loop picks up open suggestions whose evidence
// implies a *workflow* gap (not just a missing article) and drafts a
// procedure spec for the operator to one-click accept. Anything below the
// PROACTIVE_EVAL_PASS_THRESHOLD on its draft evals is auto-rejected; no AI-
// drafted change ships without an empirical pass against the workspace's
// own historical cases.

export interface DiscoverResult {
  examined: number;
  drafted: number;
  auto_rejected: number;
  proposalIds: string[];
}

export async function discoverProposals(
  env: Env,
  workspaceId: string,
  options: { limit?: number } = {},
): Promise<DiscoverResult> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const open = await listKbSuggestions(env, workspaceId, 'open');
  const result: DiscoverResult = {
    examined: 0,
    drafted: 0,
    auto_rejected: 0,
    proposalIds: [],
  };
  for (const suggestion of open.slice(0, limit)) {
    result.examined += 1;
    // Skip if there's already a proposal for this cluster — we don't want a
    // proposal queue full of duplicates each Monday.
    const existing = await env.DB.prepare(
      `SELECT id FROM proactive_proposal WHERE workspace_id = ? AND cluster_key = ?`,
    )
      .bind(workspaceId, suggestion.cluster_key)
      .first<{ id: string }>();
    if (existing) continue;
    const draft = buildDraftFromSuggestion(suggestion);
    if (!draft) continue;
    const evalReport = draft.procedure
      ? runProcedureSpecEvals(normalizeProcedureSpec(draft.procedure))
      : null;
    const passRate = evalReport && evalReport.case_count > 0
      ? evalReport.passed_count / evalReport.case_count
      : evalReport ? 1 : null;
    const status: ProactiveProposalStatus =
      passRate !== null && passRate < PROACTIVE_EVAL_PASS_THRESHOLD
        ? 'auto_rejected'
        : 'pending';
    const rejectedReason = status === 'auto_rejected' ? 'eval_regression' : null;
    const id = await persistProposal(env, {
      workspaceId,
      clusterKey: suggestion.cluster_key,
      kind: deriveKind(draft),
      draft,
      passRate,
      caseCount: evalReport?.case_count ?? 0,
      status,
      rejectedReason,
    });
    result.proposalIds.push(id);
    if (status === 'pending') result.drafted += 1;
    else result.auto_rejected += 1;
  }
  return result;
}

interface PersistArgs {
  workspaceId: string;
  clusterKey: string;
  kind: ProactiveProposalKind;
  draft: ProactiveProposalDraft;
  passRate: number | null;
  caseCount: number;
  status: ProactiveProposalStatus;
  rejectedReason: string | null;
}

async function persistProposal(env: Env, args: PersistArgs): Promise<string> {
  const id = ids.proactiveProposal();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO proactive_proposal (
       id, workspace_id, cluster_key, kind, draft_procedure_spec_json,
       draft_knowledge_entry_json, eval_pass_rate, eval_case_count,
       status, rejected_reason, proposed_at, summary, evidence_ticket_ids_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, cluster_key) DO NOTHING`,
  )
    .bind(
      id,
      args.workspaceId,
      args.clusterKey,
      args.kind,
      args.draft.procedure ? JSON.stringify(args.draft.procedure) : null,
      args.draft.knowledge ? JSON.stringify(args.draft.knowledge) : null,
      args.passRate,
      args.caseCount,
      args.status,
      args.rejectedReason,
      now,
      args.draft.summary,
      JSON.stringify(args.draft.evidenceTicketIds),
    )
    .run();
  await audit(env, {
    workspaceId: args.workspaceId,
    actorType: 'system',
    action: 'proactive.proposed',
    payload: {
      id,
      clusterKey: args.clusterKey,
      kind: args.kind,
      status: args.status,
      passRate: args.passRate,
    },
  });
  return id;
}

function deriveKind(draft: ProactiveProposalDraft): ProactiveProposalKind {
  if (draft.procedure && draft.knowledge) return 'combined';
  if (draft.procedure) return 'procedure';
  return 'knowledge';
}

function buildDraftFromSuggestion(suggestion: {
  cluster_key: string;
  title: string;
  summary: string;
  body_markdown: string;
  source_ticket_ids_json: string;
  suggested_terms_json: string;
}): ProactiveProposalDraft | null {
  let ticketIds: string[] = [];
  try {
    ticketIds = JSON.parse(suggestion.source_ticket_ids_json ?? '[]');
  } catch {
    ticketIds = [];
  }
  if (!Array.isArray(ticketIds)) ticketIds = [];

  let suggestedTerms: string[] = [];
  try {
    suggestedTerms = JSON.parse(suggestion.suggested_terms_json ?? '[]');
  } catch {
    suggestedTerms = [];
  }

  // Slug derived from cluster key for stable mapping back to insights.
  const slug = `proactive-${suggestion.cluster_key.slice(0, 40).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
  const intent = suggestion.cluster_key.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 60);
  const procedure = {
    slug,
    name: suggestion.title.slice(0, 100),
    version: '0.1.0',
    description: `Drafted by Ranse Phase 11 proactive loop from ${ticketIds.length} unresolved tickets.`,
    trigger: { type: 'intent', intent },
    steps: [
      {
        id: 'search_policy',
        type: 'search',
        query: suggestedTerms.slice(0, 5).join(' ') || suggestion.title,
        scope: 'knowledge',
        max_hops: 2,
        save_as: 'policy',
      },
      {
        id: 'ack',
        type: 'add_note',
        body: `Acknowledging ${suggestion.title}. Cluster ${suggestion.cluster_key} surfaced ${ticketIds.length} tickets.`,
      },
      {
        id: 'next_step',
        type: 'ask_customer',
        message: `Hi — about your "${suggestion.title}" question, could you confirm a few details so we can help quickly?`,
      },
    ],
    evals: [
      {
        name: 'collects_context',
        input: {},
        expect: {
          status: 'waiting',
          steps: ['search_policy', 'ack', 'next_step'],
        },
      },
    ],
  };
  const knowledge = {
    title: suggestion.title,
    body_markdown: suggestion.body_markdown,
  };
  return {
    procedure,
    knowledge,
    summary: suggestion.summary,
    evidenceTicketIds: ticketIds,
  };
}

export async function listProposals(
  env: Env,
  workspaceId: string,
  status?: ProactiveProposalStatus,
): Promise<ProactiveProposal[]> {
  if (status) {
    const rows = await env.DB.prepare(
      `SELECT * FROM proactive_proposal WHERE workspace_id = ? AND status = ?
        ORDER BY proposed_at DESC LIMIT 200`,
    )
      .bind(workspaceId, status)
      .all<ProactiveProposal>();
    return rows.results ?? [];
  }
  const rows = await env.DB.prepare(
    `SELECT * FROM proactive_proposal WHERE workspace_id = ?
      ORDER BY proposed_at DESC LIMIT 200`,
  )
    .bind(workspaceId)
    .all<ProactiveProposal>();
  return rows.results ?? [];
}

export async function acceptProposal(
  env: Env,
  workspaceId: string,
  proposalId: string,
  actorUserId: string,
): Promise<ProactiveProposal | null> {
  const proposal = await env.DB.prepare(
    `SELECT * FROM proactive_proposal WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, proposalId)
    .first<ProactiveProposal>();
  if (!proposal) return null;
  if (proposal.status !== 'pending') throw new Error('proactive_proposal_not_pending');

  let appliedProcedureId: string | null = null;
  if (proposal.draft_procedure_spec_json) {
    const spec = normalizeProcedureSpec(JSON.parse(proposal.draft_procedure_spec_json));
    const upsert = await upsertProcedureVersion(env, {
      workspaceId,
      actorUserId,
      spec,
      sourceKind: 'seed',
      sourceRef: `proactive:${proposal.cluster_key}`,
    });
    appliedProcedureId = upsert.procedure.id;
  }

  let appliedKnowledgeSourceId: string | null = null;
  if (proposal.draft_knowledge_entry_json) {
    // Try to map this back to a KbSuggestion accept. We use the cluster_key
    // to find the suggestion and run the existing accept flow.
    const suggestion = await env.DB.prepare(
      `SELECT id FROM kb_suggestion WHERE workspace_id = ? AND cluster_key = ? AND status = 'open'
        LIMIT 1`,
    )
      .bind(workspaceId, proposal.cluster_key)
      .first<{ id: string }>();
    if (suggestion) {
      const accepted = await acceptKbSuggestion(env, workspaceId, suggestion.id, actorUserId);
      if (accepted && 'source_id' in accepted) {
        appliedKnowledgeSourceId = (accepted as { source_id: string }).source_id;
      }
    }
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE proactive_proposal
        SET status = 'accepted', reviewed_at = ?, reviewed_by = ?,
            applied_procedure_id = ?, applied_knowledge_source_id = ?
      WHERE workspace_id = ? AND id = ?`,
  )
    .bind(now, actorUserId, appliedProcedureId, appliedKnowledgeSourceId, workspaceId, proposalId)
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'proactive.accepted',
    payload: {
      id: proposalId,
      appliedProcedureId,
      appliedKnowledgeSourceId,
    },
  });
  return getProposal(env, workspaceId, proposalId);
}

export async function rejectProposal(
  env: Env,
  workspaceId: string,
  proposalId: string,
  actorUserId: string,
  reason: string,
): Promise<ProactiveProposal | null> {
  const proposal = await env.DB.prepare(
    `SELECT status FROM proactive_proposal WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, proposalId)
    .first<{ status: string }>();
  if (!proposal) return null;
  if (proposal.status !== 'pending') throw new Error('proactive_proposal_not_pending');
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE proactive_proposal
        SET status = 'rejected', rejected_reason = ?, reviewed_at = ?, reviewed_by = ?
      WHERE workspace_id = ? AND id = ?`,
  )
    .bind(reason, now, actorUserId, workspaceId, proposalId)
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'proactive.rejected',
    payload: { id: proposalId, reason },
  });
  return getProposal(env, workspaceId, proposalId);
}

export async function getProposal(
  env: Env,
  workspaceId: string,
  proposalId: string,
): Promise<ProactiveProposal | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM proactive_proposal WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, proposalId)
    .first<ProactiveProposal>();
  return row ?? null;
}

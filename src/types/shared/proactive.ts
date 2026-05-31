import type { ProactiveProposal, ProactiveProposalDraft } from '../../interfaces/proactive';
export type { ProactiveProposal, ProactiveProposalDraft };
export const PROACTIVE_PROPOSAL_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'auto_rejected',
] as const;
export type ProactiveProposalStatus = (typeof PROACTIVE_PROPOSAL_STATUSES)[number];

export const PROACTIVE_PROPOSAL_KINDS = ['procedure', 'knowledge', 'combined'] as const;
export type ProactiveProposalKind = (typeof PROACTIVE_PROPOSAL_KINDS)[number];

// Eval gate: a proactive proposal can only be queued for human review if at
// least this fraction of its draft's eval cases pass. Set conservatively —
// we'd rather miss an opportunity than ship a regression silently.
export const PROACTIVE_EVAL_PASS_THRESHOLD = 0.8;

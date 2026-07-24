import { INJECTION_PATTERNS, RESTRICTED_TOPICS } from '../../../../config/autonomy';
import type { DraftResult } from '../../../schemas/draft';
import type { TriageResult } from '../../../schemas/triage';

// Deterministic guardrail layer in front of autonomy. Customer content is
// untrusted LLM input, so jailbreak attempts and restricted topics force the
// human-approval path regardless of how confident the draft looks (the same
// policy Fin applies). Heuristic on purpose: it costs nothing per message,
// cannot itself be prompt-injected, and errs toward escalation.
/** Hard-block reasons derived from raw customer text. Empty = no concern. */
export function assessContentRisk(customerText: string): string[] {
  const reasons: string[] = [];
  if (INJECTION_PATTERNS.some((p) => p.test(customerText))) {
    reasons.push('possible_prompt_injection');
  }
  for (const [reason, pattern] of RESTRICTED_TOPICS) {
    if (pattern.test(customerText)) reasons.push(reason);
  }
  return reasons;
}

/**
 * All content-level hard blocks for an autonomy decision: injection and
 * restricted topics from the customer text, plus a language mismatch between
 * what the customer wrote and what the draft answered in — a wrong-language
 * auto-send is a top community failure mode.
 */
export function contentHardBlocks(
  customerText: string,
  triage: TriageResult,
  draft: DraftResult,
): string[] {
  const reasons = assessContentRisk(customerText);
  const customerLang = triage.language?.trim().toLowerCase();
  const draftLang = draft.language?.trim().toLowerCase();
  if (customerLang && draftLang && customerLang !== draftLang) {
    reasons.push('language_mismatch');
  }
  return reasons;
}

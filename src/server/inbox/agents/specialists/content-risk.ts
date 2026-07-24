import type { DraftResult } from '../../../schemas/draft';
import type { TriageResult } from '../../../schemas/triage';

// Deterministic guardrail layer in front of autonomy. Customer content is
// untrusted LLM input, so jailbreak attempts and restricted topics force the
// human-approval path regardless of how confident the draft looks (the same
// policy Fin applies). Heuristic on purpose: it costs nothing per message,
// cannot itself be prompt-injected, and errs toward escalation.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(your|all|the)\s+(instructions?|rules?|guidelines?|system\s+prompt)/i,
  /(reveal|show|print|repeat)\s+(your|the)\s+(system\s+prompt|instructions?|hidden\s+rules?)/i,
  /you\s+are\s+now\s+(a|an|in)\b/i,
  /\b(jailbreak|dan\s+mode|developer\s+mode)\b/i,
  /<\/?\s*(system|assistant|instructions?)\s*>/i,
  /\bas\s+an?\s+ai\b.{0,40}\b(pretend|roleplay|act\s+as)\b/i,
];

const RESTRICTED_TOPICS: Array<[string, RegExp]> = [
  [
    'restricted_topic_self_harm',
    /\b(suicid\w*|self.?harm|(kill|hurt|harm)(ing)?\s+(myself|himself|herself|themselves)|end(ing)?\s+my\s+life)\b/i,
  ],
  [
    'restricted_topic_legal',
    /\b(lawsuit|attorney|lawyer|legal\s+action|small\s+claims|subpoena|su(e|ing)\s+(you|your))\b/i,
  ],
  [
    'restricted_topic_medical',
    /\b(diagnos\w*|prescri\w*|medical\s+advice|overdose|dosage|allergic\s+reaction)\b/i,
  ],
];

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

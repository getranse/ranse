/** Workspace autonomy policy thresholds. Operator-tunable defaults applied when a mailbox sets `autonomy_policy='auto_send_if_confident'` without specifying a custom threshold. */
export const DEFAULT_AUTONOMY_THRESHOLD = 0.85;
export const MIN_AUTONOMY_THRESHOLD = 0.5;
export const MAX_AUTONOMY_THRESHOLD = 0.99;

/** Rollout percent for auto-send (0–100). 100 = enabled for all tickets. */
export const DEFAULT_AUTONOMY_ROLLOUT_PERCENT = 100;

/** Customer-text patterns that hard-block autonomy (see specialists/content-risk). */
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(your|all|the)\s+(instructions?|rules?|guidelines?|system\s+prompt)/i,
  /(reveal|show|print|repeat)\s+(your|the)\s+(system\s+prompt|instructions?|hidden\s+rules?)/i,
  /you\s+are\s+now\s+(a|an|in)\b/i,
  /\b(jailbreak|dan\s+mode|developer\s+mode)\b/i,
  /<\/?\s*(system|assistant|instructions?)\s*>/i,
  /\bas\s+an?\s+ai\b.{0,40}\b(pretend|roleplay|act\s+as)\b/i,
];

export const RESTRICTED_TOPICS: Array<[string, RegExp]> = [
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

// Deterministic tone heuristic shared by the conversation QA rubric and the
// replay evals: hostile/dismissive phrasing, shouting, and curt one-liners
// score low. Cheap on purpose — it runs on every scored conversation.
export function scoreTone(text: string): number {
  if (!text.trim()) return 0.5;
  const lower = text.toLowerCase();
  let score = 0.82;
  if (/\b(thank|thanks|please|happy to help|i can help)\b/.test(lower)) score += 0.08;
  if (/\b(stupid|obvious|not our problem|as stated|you failed|you must)\b/.test(lower))
    score -= 0.28;
  if (/[A-Z]{12,}/.test(text)) score -= 0.12;
  if (lower.length < 40) score -= 0.08;
  return Math.min(1, Math.max(0, score));
}

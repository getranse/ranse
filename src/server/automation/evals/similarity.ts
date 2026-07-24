// Token-overlap similarity used to compare replayed drafts against the
// historical human reply. Stop-words are dropped so boilerplate greetings
// don't inflate the score.
export function scoreTextSimilarity(expected: string, actual: string): number {
  const expectedTokens = tokenSet(expected);
  const actualTokens = tokenSet(actual);
  if (expectedTokens.size === 0 || actualTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) overlap += 1;
  }
  return Number((overlap / expectedTokens.size).toFixed(4));
}

function tokenSet(value: string): Set<string> {
  const stop = new Set([
    'about',
    'after',
    'again',
    'also',
    'because',
    'before',
    'could',
    'hello',
    'please',
    'thank',
    'thanks',
    'there',
    'these',
    'those',
    'would',
    'your',
  ]);
  return new Set(
    (value.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter((token) => !stop.has(token)),
  );
}

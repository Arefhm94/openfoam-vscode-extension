/** Classic edit-distance — insert/delete/substitute, unit cost each. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The candidate closest to `word` by edit distance (case-insensitive),
 * or `undefined` if nothing is close enough. The default threshold scales
 * with word length so a 3-letter typo needs a near-exact match while a
 * long key tolerates a couple more edits.
 */
export function closestMatch(
  word: string,
  candidates: readonly string[],
  maxDistance: number = Math.max(2, Math.ceil(word.length / 3)),
): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  const w = word.toLowerCase();
  for (const c of candidates) {
    const d = levenshtein(w, c.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return bestDist <= maxDistance ? best : undefined;
}

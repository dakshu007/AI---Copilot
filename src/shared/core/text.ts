const STOP_WORDS = new Set(
  `a an and are as at be been but by can could did do does for from had has have how i if in into is it its
  me my of on or our so than that the their them then there these they this to us was we were what when where
  which who why will with would you your about tell describe explain walk through give example time can't`
    .split(/\s+/)
    .filter(Boolean),
);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9#+.'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower-cased content words without stop words, useful for overlap scoring. */
export function contentTokens(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(contentTokens(a));
  const setB = new Set(contentTokens(b));
  if (setA.size === 0 && setB.size === 0) return normalizeText(a) === normalizeText(b) ? 1 : 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Fraction of `query` tokens found in `doc`. */
export function overlapScore(query: string | string[], doc: string): number {
  const queryTokens = Array.isArray(query) ? query : contentTokens(query);
  if (queryTokens.length === 0) return 0;
  const docTokens = new Set(contentTokens(doc));
  let hits = 0;
  for (const token of queryTokens) if (docTokens.has(token)) hits += 1;
  return hits / queryTokens.length;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(0, maxChars - 1));
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

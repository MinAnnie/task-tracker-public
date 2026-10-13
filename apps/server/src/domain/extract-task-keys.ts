const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds known task keys (e.g. "RF-04") in free text such as a PR title or branch name.
 *
 * - Case-insensitive; returns the canonical casing from `knownKeys`.
 * - A key only matches when it is not glued to other letters/digits, so "RF-04"
 *   does not match inside "RF-040" or "XRF-04". Separators such as "/", "-", "_",
 *   ".", ":", "[", "]", "(", ")" and whitespace are accepted around a key.
 * - Overlapping keys prefer the longest match ("RF-04-1" over "RF-04").
 * - Results are deduplicated and ordered by first appearance.
 */
export function extractTaskKeys(text: string, knownKeys: readonly string[]): string[] {
  const canonicalByLower = new Map<string, string>();
  for (const key of knownKeys) {
    if (key.length > 0 && !canonicalByLower.has(key.toLowerCase())) {
      canonicalByLower.set(key.toLowerCase(), key);
    }
  }
  if (text.length === 0 || canonicalByLower.size === 0) return [];

  const alternatives = [...canonicalByLower.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(`(?<![a-z0-9])(?:${alternatives})(?![a-z0-9])`, "gi");

  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const canonical = canonicalByLower.get(match[0].toLowerCase());
    if (canonical !== undefined) found.add(canonical);
  }
  return [...found];
}

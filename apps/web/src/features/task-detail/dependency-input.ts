/** A task the dependency field suggests. */
export interface DependencyOption {
  key: string;
  title: string;
}

export type DependencyInput = { ok: true; key: string } | { ok: false; reason: "empty" | "no_match" | "ambiguous" };

/** `RF-14`, `AUTH-08B`: a prefix, a hyphen, digits and an optional letter. */
const KEY_SHAPE = /^[a-z][a-z0-9]*-\d+[a-z]?$/i;

/**
 * Turns what was typed in the dependency field into a task key. The field invites a
 * search, so besides a key it accepts a suggestion's label ("RF-38 Mapa…") or part of
 * one task's title. Key-shaped text goes to the server as typed, which has the final
 * word; other text must match exactly one suggestion.
 */
export function resolveDependencyInput(text: string, options: readonly DependencyOption[]): DependencyInput {
  const typed = text.trim();
  if (typed === "") return { ok: false, reason: "empty" };
  if (KEY_SHAPE.test(typed)) return { ok: true, key: typed };

  const needle = typed.toLowerCase();
  const labelled = options.find((o) => `${o.key} ${o.title}`.toLowerCase() === needle);
  if (labelled) return { ok: true, key: labelled.key };

  const matches = options.filter((o) => o.title.toLowerCase().includes(needle));
  if (matches.length === 1) return { ok: true, key: matches[0]!.key };
  return { ok: false, reason: matches.length === 0 ? "no_match" : "ambiguous" };
}

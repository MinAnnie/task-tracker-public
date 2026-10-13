import { useCallback, useEffect, useRef, useState } from "react";

/** Copies text to the clipboard; resolves `false` when the API is missing or refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type CopyOutcome<Id extends string> = { status: "copied"; id: Id } | { status: "failed"; id: Id };

/**
 * Copies text and remembers which control did it: `copied` lasts `resetMs`
 * (long enough to read "Copied"), `failed` stays until the next attempt.
 */
export function useCopyFeedback<Id extends string>(resetMs = 2000) {
  const [outcome, setOutcome] = useState<CopyOutcome<Id>>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (id: Id, text: string) => {
      clearTimeout(timer.current);
      const ok = await copyText(text);
      setOutcome({ status: ok ? "copied" : "failed", id });
      if (ok) timer.current = setTimeout(() => setOutcome(undefined), resetMs);
      return ok;
    },
    [resetMs],
  );

  return { outcome, copy };
}

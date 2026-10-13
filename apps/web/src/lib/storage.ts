/**
 * Per-browser preferences. Storage can be missing or throw (private mode, blocked
 * site data), and preferences are never essential, so every access is guarded.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembering a preference is fine.
  }
}

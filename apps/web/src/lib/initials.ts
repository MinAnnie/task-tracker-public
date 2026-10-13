/** Two-letter avatar text: initials of a two-word name, else the first letters of the name or login. */
export function initials({ login, name }: { login: string; name: string | null }): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return (words[0] ?? login).slice(0, 2).toUpperCase();
}

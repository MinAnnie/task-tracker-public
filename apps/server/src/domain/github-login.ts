/** GitHub username rules: 1–39 alphanumerics or single hyphens, no leading or trailing hyphen. */
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;

/** Returns the lowercased login when `value` is a valid GitHub username, `undefined` otherwise. */
export function normalizeGithubLogin(value: unknown): string | undefined {
  if (typeof value !== "string" || !GITHUB_LOGIN.test(value)) return undefined;
  return value.toLowerCase();
}

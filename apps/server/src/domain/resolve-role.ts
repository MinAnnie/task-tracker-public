export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Decides what a GitHub login may do. Admins come only from configuration and
 * win over membership; anyone else needs a member record.
 *
 * @param adminLogins lowercased admin logins.
 * @returns `null` when the login has no access at all.
 */
export function resolveRole(
  login: string,
  adminLogins: readonly string[],
  isMember: boolean,
): Role | null {
  if (adminLogins.includes(login.toLowerCase())) return "admin";
  return isMember ? "member" : null;
}

import { resolveRole, type Role } from "../domain/resolve-role.ts";
import type { AuthStore, SessionUser } from "./auth-store.ts";
import { hashSessionToken } from "./session-token.ts";

export interface SessionDeps {
  store: AuthStore;
  /** Lowercased GitHub logins with the admin role. */
  adminLogins: readonly string[];
  now?: () => Date;
}

/** A signed-in user together with the role resolved for this request. */
export interface AuthenticatedUser extends SessionUser {
  role: Role;
}

/**
 * Resolves the user behind a session token and re-resolves their role on every call.
 *
 * - Expired sessions are treated as absent and deleted on sight.
 * - A user who is no longer an admin or member is treated as absent and all of
 *   their sessions are deleted, so revoking access takes effect immediately.
 */
export async function findSessionUser(
  { store, adminLogins, now = () => new Date() }: SessionDeps,
  sessionToken: string,
): Promise<AuthenticatedUser | undefined> {
  const tokenHash = hashSessionToken(sessionToken);
  const session = await store.findSessionByTokenHash(tokenHash);
  if (session === undefined) return undefined;
  if (session.expiresAt.getTime() <= now().getTime()) {
    await store.deleteSessionByTokenHash(tokenHash);
    return undefined;
  }

  const { user } = session;
  const isMember = await store.isMember(user.githubLogin.toLowerCase());
  const role = resolveRole(user.githubLogin, adminLogins, isMember);
  if (role === null) {
    await store.deleteSessionsByUserId(user.id);
    return undefined;
  }
  return { ...user, role };
}

/** Deletes the session behind a token; unknown tokens are ignored. */
export async function endSession(store: AuthStore, sessionToken: string): Promise<void> {
  await store.deleteSessionByTokenHash(hashSessionToken(sessionToken));
}

import { resolveRole } from "../domain/resolve-role.ts";
import type { AuthStore, GithubUserProfile } from "./auth-store.ts";
import { generateSessionToken, hashSessionToken } from "./session-token.ts";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Port for the GitHub OAuth web flow. Implemented by an HTTP adapter. */
export interface GithubOAuthClient {
  /** Trades an authorization `code` for a user access token; throws when GitHub refuses it. */
  exchangeCode(code: string): Promise<string>;
  /** Reads the profile of the user owning `accessToken`. */
  fetchUser(accessToken: string): Promise<GithubUserProfile>;
}

export interface CompleteGithubLoginDeps {
  store: AuthStore;
  github: GithubOAuthClient;
  /** Lowercased GitHub logins with the admin role; anyone else needs a member record. */
  adminLogins: readonly string[];
  now?: () => Date;
  generateToken?: () => string;
}

export type CompleteGithubLoginResult =
  | { status: "forbidden"; login: string }
  | { status: "authenticated"; userId: number; sessionToken: string; expiresAt: Date };

/**
 * Finishes a GitHub OAuth login: resolves the GitHub account behind `code` and,
 * when its login resolves to a role (admin or member), upserts the user and opens
 * a new session.
 *
 * - Logins are compared case-insensitively; a login without a role creates nothing.
 * - Only the SHA-256 of the session token is persisted; the raw token is returned
 *   once so the caller can hand it to the browser.
 */
export async function completeGithubLogin(
  { store, github, adminLogins, now = () => new Date(), generateToken = generateSessionToken }:
    CompleteGithubLoginDeps,
  code: string,
): Promise<CompleteGithubLoginResult> {
  const accessToken = await github.exchangeCode(code);
  const profile = await github.fetchUser(accessToken);
  const isMember = await store.isMember(profile.login.toLowerCase());
  if (resolveRole(profile.login, adminLogins, isMember) === null) {
    return { status: "forbidden", login: profile.login };
  }

  const sessionToken = generateToken();
  const expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
  const userId = await store.transaction(async (tx) => {
    const { id } = await tx.upsertUserByGithubId(profile);
    await tx.createSession({ userId: id, tokenHash: hashSessionToken(sessionToken), expiresAt });
    return id;
  });

  return { status: "authenticated", userId, sessionToken, expiresAt };
}

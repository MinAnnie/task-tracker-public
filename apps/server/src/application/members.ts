import { normalizeGithubLogin } from "../domain/github-login.ts";
import type { AuthStore, MemberRecord, SessionUser } from "./auth-store.ts";

export interface MembersDeps {
  store: AuthStore;
  /** Lowercased GitHub logins with the admin role (configuration, not stored). */
  adminLogins: readonly string[];
}

export interface MembersOverview {
  /** Configured admins; read-only from the app. */
  admins: string[];
  members: MemberRecord[];
}

export type AddMemberResult =
  | { status: "created"; member: MemberRecord }
  | { status: "invalid_login" }
  | { status: "already_admin"; githubLogin: string }
  | { status: "already_member"; githubLogin: string };

export type RemoveMemberResult = { status: "removed" } | { status: "not_found" };

export async function listMembers({ store, adminLogins }: MembersDeps): Promise<MembersOverview> {
  return { admins: [...adminLogins], members: await store.listMembers() };
}

/** Grants the member role to a GitHub login; `githubLogin` is untrusted input. */
export async function addMember(
  { store, adminLogins }: MembersDeps,
  { githubLogin, actor }: { githubLogin: unknown; actor: SessionUser },
): Promise<AddMemberResult> {
  const login = normalizeGithubLogin(githubLogin);
  if (login === undefined) return { status: "invalid_login" };
  if (adminLogins.includes(login)) return { status: "already_admin", githubLogin: login };

  const created = await store.addMember({ githubLogin: login, addedByUserId: actor.id });
  if (created === undefined) return { status: "already_member", githubLogin: login };
  return {
    status: "created",
    member: { githubLogin: login, createdAt: created.createdAt, addedBy: actor.githubLogin },
  };
}

/**
 * Revokes a member and, in the same transaction, deletes the sessions of the
 * matching users so access ends immediately and unassigns their tasks that are
 * not done in every project, sending `in_progress` ones back to `todo` (project
 * memberships go by FK cascade). Configured
 * admins keep their sessions and tasks because they still have access.
 */
export async function removeMember(
  { store, adminLogins }: MembersDeps,
  githubLogin: string,
): Promise<RemoveMemberResult> {
  const login = normalizeGithubLogin(githubLogin);
  if (login === undefined) return { status: "not_found" };

  const removed = await store.transaction(async (tx) => {
    if (!(await tx.removeMember(login))) return false;
    if (!adminLogins.includes(login)) {
      await tx.deleteSessionsByGithubLogin(login);
      await tx.unassignOpenTasksByGithubLogin(login);
    }
    return true;
  });
  return removed ? { status: "removed" } : { status: "not_found" };
}

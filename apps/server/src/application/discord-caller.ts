import { resolveRole } from "../domain/resolve-role.ts";
import type { AuthStore } from "./auth-store.ts";
import type { ProjectStore } from "./project-store.ts";
import type { AuthenticatedUser } from "./sessions.ts";

export interface DiscordCallerDeps {
  auth: AuthStore;
  projects: ProjectStore;
  /** Lowercased GitHub logins with the admin role. */
  adminLogins: readonly string[];
}

export type DiscordCallerResult =
  | { status: "ok"; user: AuthenticatedUser; project: { slug: string; name: string } }
  | { status: "not_linked" }
  | { status: "no_access" }
  | { status: "channel_not_linked" };

/**
 * Resolves who runs a Discord slash command and for which project, with the same
 * role rules as a web session (re-resolved on every call, so revoking access takes
 * effect immediately). Project participation is left to the task use cases.
 */
export async function resolveDiscordCaller(
  { auth, projects, adminLogins }: DiscordCallerDeps,
  discordUserId: string,
  channelId: string,
): Promise<DiscordCallerResult> {
  const user = await auth.findUserByDiscordId(discordUserId);
  if (user === undefined) return { status: "not_linked" };
  const role = resolveRole(user.githubLogin, adminLogins, await auth.isMember(user.githubLogin.toLowerCase()));
  if (role === null) return { status: "no_access" };
  const project = await projects.findProjectByDiscordChannelId(channelId);
  if (project === undefined) return { status: "channel_not_linked" };
  return { status: "ok", user: { ...user, role }, project: { slug: project.slug, name: project.name } };
}

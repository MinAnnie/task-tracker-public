import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthStore } from "../../test/fakes/in-memory-auth-store.ts";
import { InMemoryProjectStore } from "../../test/fakes/in-memory-project-store.ts";
import { resolveDiscordCaller, type DiscordCallerDeps } from "./discord-caller.ts";

const CHANNEL = "222222222222222222";
const DISCORD_USER = "111111111111111111";

describe("resolveDiscordCaller", () => {
  let auth: InMemoryAuthStore;
  let projects: InMemoryProjectStore;
  let deps: DiscordCallerDeps;
  let monaId: number;

  beforeEach(async () => {
    auth = new InMemoryAuthStore();
    projects = new InMemoryProjectStore();
    deps = { auth, projects, adminLogins: ["octocat"] };
    monaId = (await auth.upsertUserByGithubId({ githubId: 2, login: "Mona", name: "Mona Lisa", avatarUrl: null })).id;
    await auth.addMember({ githubLogin: "mona", addedByUserId: null });
    await projects.createProject({ slug: "shop", name: "Shop", taskKeyPrefix: "SH", discordChannelId: CHANNEL });
  });

  it("resolves the linked user with their role and the channel's project", async () => {
    await auth.setDiscordAccount(monaId, { id: DISCORD_USER, username: "mona" });

    expect(await resolveDiscordCaller(deps, DISCORD_USER, CHANNEL)).toEqual({
      status: "ok",
      user: { id: monaId, githubLogin: "Mona", name: "Mona Lisa", avatarUrl: null, role: "member" },
      project: { slug: "shop", name: "Shop" },
    });
  });

  it("gives configured admins the admin role", async () => {
    const octocatId = (await auth.upsertUserByGithubId({ githubId: 1, login: "octocat", name: null, avatarUrl: null })).id;
    await auth.setDiscordAccount(octocatId, { id: DISCORD_USER, username: "octo" });

    const result = await resolveDiscordCaller(deps, DISCORD_USER, CHANNEL);
    expect(result.status === "ok" && result.user.role).toBe("admin");
  });

  it("reports a Discord account that is not linked to any user", async () => {
    expect(await resolveDiscordCaller(deps, DISCORD_USER, CHANNEL)).toEqual({ status: "not_linked" });
  });

  it("reports a linked user who is no longer an admin or member", async () => {
    await auth.setDiscordAccount(monaId, { id: DISCORD_USER, username: "mona" });
    await auth.removeMember("mona");

    expect(await resolveDiscordCaller(deps, DISCORD_USER, CHANNEL)).toEqual({ status: "no_access" });
  });

  it("reports a channel that no project uses", async () => {
    await auth.setDiscordAccount(monaId, { id: DISCORD_USER, username: "mona" });

    expect(await resolveDiscordCaller(deps, DISCORD_USER, "333")).toEqual({ status: "channel_not_linked" });
  });
});

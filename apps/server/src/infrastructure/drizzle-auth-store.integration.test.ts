import { eq, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import { completeGithubLogin } from "../application/complete-github-login.ts";
import { completeDiscordLink, unlinkDiscordAccount } from "../application/discord-link.ts";
import { hashSessionToken } from "../application/session-token.ts";
import { addMember, removeMember } from "../application/members.ts";
import { endSession, findSessionUser } from "../application/sessions.ts";
import { createDb } from "../db/client.ts";
import { members, sessions, users } from "../db/schema.ts";
import { createDrizzleAuthStore } from "./drizzle-auth-store.ts";

const { sql, db } = createDb(testDatabaseUrl);
const store = createDrizzleAuthStore(db);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const profile = {
  githubId: 583231,
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/583231",
};

const future = () => new Date(Date.now() + 60 * 60 * 1000);

describe("createDrizzleAuthStore (Postgres)", () => {
  beforeEach(async () => {
    await db.execute(
      rawSql`truncate table members, sessions, task_pull_requests, pull_requests, tasks, repositories, users, projects restart identity cascade`,
    );
  });

  it("upserts users by GitHub id, refreshing login, name and avatar", async () => {
    const first = await store.upsertUserByGithubId(profile);
    const second = await store.upsertUserByGithubId({
      ...profile,
      login: "octo-renamed",
      name: null,
      avatarUrl: null,
    });

    expect(second.id).toBe(first.id);
    expect(await db.select().from(users)).toEqual([
      expect.objectContaining({
        id: first.id,
        githubId: profile.githubId,
        githubLogin: "octo-renamed",
        name: null,
        avatarUrl: null,
      }),
    ]);
  });

  it("finds a session with its user by token hash", async () => {
    const { id: userId } = await store.upsertUserByGithubId(profile);
    const expiresAt = future();
    await store.createSession({ userId, tokenHash: "hash-1", expiresAt });

    expect(await store.findSessionByTokenHash("hash-1")).toEqual({
      expiresAt,
      user: { id: userId, githubLogin: "octocat", name: "The Octocat", avatarUrl: profile.avatarUrl },
    });
    expect(await store.findSessionByTokenHash("missing")).toBeUndefined();
  });

  it("rejects duplicate token hashes", async () => {
    const { id: userId } = await store.upsertUserByGithubId(profile);
    await store.createSession({ userId, tokenHash: "dup", expiresAt: future() });
    await expect(
      store.createSession({ userId, tokenHash: "dup", expiresAt: future() }),
    ).rejects.toThrow();
  });

  it("deletes sessions by token hash", async () => {
    const { id: userId } = await store.upsertUserByGithubId(profile);
    await store.createSession({ userId, tokenHash: "keep", expiresAt: future() });
    await store.createSession({ userId, tokenHash: "drop", expiresAt: future() });

    await store.deleteSessionByTokenHash("drop");

    const rows = await db.select({ tokenHash: sessions.tokenHash }).from(sessions);
    expect(rows).toEqual([{ tokenHash: "keep" }]);
  });

  it("deletes a user's sessions when the user is deleted", async () => {
    const { id: userId } = await store.upsertUserByGithubId(profile);
    await store.createSession({ userId, tokenHash: "h", expiresAt: future() });
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(sessions)).toEqual([]);
  });

  it("rolls back the user upsert when session creation fails inside a transaction", async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.upsertUserByGithubId(profile);
        await tx.createSession({ userId: 999_999, tokenHash: "h", expiresAt: future() });
      }),
    ).rejects.toThrow();
    expect(await db.select().from(users)).toEqual([]);
  });

  it("supports the full login → me → logout flow through the use cases", async () => {
    const result = await completeGithubLogin(
      {
        store,
        github: {
          exchangeCode: async () => "gho_token",
          fetchUser: async () => ({ ...profile, login: "OctoCat" }),
        },
        adminLogins: ["octocat"],
      },
      "code",
    );
    if (result.status !== "authenticated") throw new Error("expected authenticated");

    const [row] = await db.select().from(sessions);
    expect(row?.tokenHash).toBe(hashSessionToken(result.sessionToken));
    const deps = { store, adminLogins: ["octocat"] };
    expect(await findSessionUser(deps, result.sessionToken)).toMatchObject({
      githubLogin: "OctoCat",
      role: "admin",
    });

    await endSession(store, result.sessionToken);
    expect(await findSessionUser(deps, result.sessionToken)).toBeUndefined();
  });

  it("deletes an expired session when it is looked up", async () => {
    const { id: userId } = await store.upsertUserByGithubId(profile);
    await store.createSession({
      userId,
      tokenHash: hashSessionToken("old"),
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await findSessionUser({ store, adminLogins: ["octocat"] }, "old")).toBeUndefined();
    expect(await db.select().from(sessions)).toEqual([]);
  });

  describe("members", () => {
    it("adds, checks and lists members with the login of who added them", async () => {
      const { id: adminId } = await store.upsertUserByGithubId(profile);

      const created = await store.addMember({ githubLogin: "mona", addedByUserId: adminId });
      await store.addMember({ githubLogin: "bob", addedByUserId: null });

      expect(created?.createdAt).toBeInstanceOf(Date);
      expect(await store.isMember("mona")).toBe(true);
      expect(await store.isMember("mallory")).toBe(false);
      expect(await store.listMembers()).toEqual([
        { githubLogin: "bob", createdAt: expect.any(Date), addedBy: null },
        { githubLogin: "mona", createdAt: created?.createdAt, addedBy: "octocat" },
      ]);
    });

    it("returns undefined for an existing member without changing it", async () => {
      const { id: adminId } = await store.upsertUserByGithubId(profile);
      await store.addMember({ githubLogin: "mona", addedByUserId: null });

      expect(await store.addMember({ githubLogin: "mona", addedByUserId: adminId })).toBeUndefined();
      expect(await db.select({ addedByUserId: members.addedByUserId }).from(members)).toEqual([
        { addedByUserId: null },
      ]);
    });

    it("rejects logins that are not lowercase", async () => {
      await expect(store.addMember({ githubLogin: "Mona", addedByUserId: null })).rejects.toThrow();
    });

    it("keeps the member but forgets who added it when that user is deleted", async () => {
      const { id: adminId } = await store.upsertUserByGithubId(profile);
      await store.addMember({ githubLogin: "mona", addedByUserId: adminId });
      await db.delete(users).where(eq(users.id, adminId));

      expect(await store.listMembers()).toEqual([
        { githubLogin: "mona", createdAt: expect.any(Date), addedBy: null },
      ]);
    });

    it("removes members, reporting whether one existed", async () => {
      await store.addMember({ githubLogin: "mona", addedByUserId: null });
      expect(await store.removeMember("mona")).toBe(true);
      expect(await store.removeMember("mona")).toBe(false);
      expect(await store.isMember("mona")).toBe(false);
    });

    it("deletes sessions by user id and by case-insensitive GitHub login", async () => {
      const { id: octo } = await store.upsertUserByGithubId(profile);
      const { id: mona } = await store.upsertUserByGithubId({ ...profile, githubId: 2, login: "Mona" });
      await store.createSession({ userId: octo, tokenHash: "o1", expiresAt: future() });
      await store.createSession({ userId: mona, tokenHash: "m1", expiresAt: future() });
      await store.createSession({ userId: mona, tokenHash: "m2", expiresAt: future() });

      await store.deleteSessionsByGithubLogin("mona");
      expect(await db.select({ tokenHash: sessions.tokenHash }).from(sessions)).toEqual([
        { tokenHash: "o1" },
      ]);

      await store.deleteSessionsByUserId(octo);
      expect(await db.select().from(sessions)).toEqual([]);
    });

    it("signs a member in and cuts their access as soon as they are removed", async () => {
      const adminLogins = ["octocat"];
      const { id: adminId } = await store.upsertUserByGithubId(profile);
      const actor = { id: adminId, githubLogin: "octocat", name: null, avatarUrl: null };
      expect(await addMember({ store, adminLogins }, { githubLogin: "Mona", actor })).toMatchObject({
        status: "created",
      });

      const login = await completeGithubLogin(
        {
          store,
          adminLogins,
          github: {
            exchangeCode: async () => "gho_token",
            fetchUser: async () => ({ ...profile, githubId: 2, login: "Mona" }),
          },
        },
        "code",
      );
      if (login.status !== "authenticated") throw new Error("expected authenticated");
      expect(await findSessionUser({ store, adminLogins }, login.sessionToken)).toMatchObject({
        githubLogin: "Mona",
        role: "member",
      });

      expect(await removeMember({ store, adminLogins }, "mona")).toEqual({ status: "removed" });
      expect(await findSessionUser({ store, adminLogins }, login.sessionToken)).toBeUndefined();
      expect(await db.select().from(sessions)).toEqual([]);
    });

    it("revokes the sessions of a user who lost access on their next lookup", async () => {
      const { id: userId } = await store.upsertUserByGithubId({ ...profile, login: "mallory" });
      await store.createSession({ userId, tokenHash: hashSessionToken("t1"), expiresAt: future() });
      await store.createSession({ userId, tokenHash: hashSessionToken("t2"), expiresAt: future() });

      expect(await findSessionUser({ store, adminLogins: ["octocat"] }, "t1")).toBeUndefined();
      expect(await db.select().from(sessions)).toEqual([]);
    });
  });

  describe("Discord accounts", () => {
    const nelly = { id: "80351110224678912", username: "Nelly" };
    const discordReturning = (account: { id: string; username: string }) => ({
      exchangeCode: async () => "discord-token",
      fetchUser: async () => account,
    });

    const twoUsers = async () => {
      const octocat = await store.upsertUserByGithubId(profile);
      const mona = await store.upsertUserByGithubId({ ...profile, githubId: 2, login: "mona" });
      return { octocatId: octocat.id, monaId: mona.id };
    };

    it("links, finds and unlinks a user's Discord account", async () => {
      const { octocatId } = await twoUsers();
      expect(await store.findDiscordAccount(octocatId)).toBeNull();

      await store.setDiscordAccount(octocatId, nelly);
      expect(await store.findDiscordAccount(octocatId)).toEqual(nelly);
      expect(await store.findUserIdByDiscordId(nelly.id)).toBe(octocatId);

      await store.setDiscordAccount(octocatId, null);
      expect(await store.findDiscordAccount(octocatId)).toBeNull();
      expect(await store.findUserIdByDiscordId(nelly.id)).toBeUndefined();
      expect(await db.select({ id: users.discordUserId, name: users.discordUsername }).from(users).where(eq(users.id, octocatId))).toEqual([
        { id: null, name: null },
      ]);
    });

    it("finds the user a Discord account is linked to", async () => {
      const { octocatId } = await twoUsers();
      expect(await store.findUserByDiscordId(nelly.id)).toBeUndefined();

      await store.setDiscordAccount(octocatId, nelly);
      expect(await store.findUserByDiscordId(nelly.id)).toEqual({
        id: octocatId,
        githubLogin: "octocat",
        name: "The Octocat",
        avatarUrl: profile.avatarUrl,
      });
    });

    it("returns null for an unknown user", async () => {
      expect(await store.findDiscordAccount(999)).toBeNull();
    });

    it("rejects linking a Discord account that already belongs to another user", async () => {
      const { octocatId, monaId } = await twoUsers();
      await store.setDiscordAccount(monaId, nelly);
      await expect(store.setDiscordAccount(octocatId, nelly)).rejects.toThrow();
    });

    it("leaves both users untouched when the use case meets an account linked elsewhere", async () => {
      const { octocatId, monaId } = await twoUsers();
      await store.setDiscordAccount(monaId, nelly);
      await store.setDiscordAccount(octocatId, { id: "1", username: "old" });

      const result = await completeDiscordLink({ store, discord: discordReturning(nelly) }, octocatId, "code");

      expect(result).toEqual({ status: "already_linked" });
      expect(await store.findDiscordAccount(monaId)).toEqual(nelly);
      expect(await store.findDiscordAccount(octocatId)).toEqual({ id: "1", username: "old" });
    });

    it("relinks a user to a different Discord account, freeing the previous one", async () => {
      const { octocatId, monaId } = await twoUsers();
      await completeDiscordLink({ store, discord: discordReturning({ id: "1", username: "old" }) }, octocatId, "a");
      expect(
        await completeDiscordLink({ store, discord: discordReturning(nelly) }, octocatId, "b"),
      ).toEqual({ status: "linked", account: nelly });

      expect(await store.findDiscordAccount(octocatId)).toEqual(nelly);
      expect(
        await completeDiscordLink({ store, discord: discordReturning({ id: "1", username: "old" }) }, monaId, "c"),
      ).toEqual({ status: "linked", account: { id: "1", username: "old" } });
    });

    it("unlinks through the use case without touching the user's profile or sessions", async () => {
      const { octocatId } = await twoUsers();
      await store.createSession({ userId: octocatId, tokenHash: "h", expiresAt: future() });
      await store.setDiscordAccount(octocatId, nelly);

      await unlinkDiscordAccount(store, octocatId);

      expect(await store.findDiscordAccount(octocatId)).toBeNull();
      expect(await store.findSessionByTokenHash("h")).toEqual(
        expect.objectContaining({ user: expect.objectContaining({ id: octocatId, githubLogin: "octocat" }) }),
      );
    });
  });
});

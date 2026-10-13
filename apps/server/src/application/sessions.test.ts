import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthStore } from "../../test/fakes/in-memory-auth-store.ts";
import { hashSessionToken } from "./session-token.ts";
import { endSession, findSessionUser, type SessionDeps } from "./sessions.ts";

const now = new Date("2026-03-01T12:00:00Z");

describe("sessions", () => {
  let store: InMemoryAuthStore;
  let deps: SessionDeps;

  const signIn = async (githubId: number, login: string, token: string, expiresAt: Date) => {
    const { id } = await store.upsertUserByGithubId({
      githubId,
      login,
      name: null,
      avatarUrl: null,
    });
    await store.createSession({ userId: id, tokenHash: hashSessionToken(token), expiresAt });
    return id;
  };

  beforeEach(async () => {
    store = new InMemoryAuthStore();
    deps = { store, adminLogins: ["octocat"], now: () => now };
    const { id } = await store.upsertUserByGithubId({
      githubId: 1,
      login: "OctoCat",
      name: "The Octocat",
      avatarUrl: "https://avatars.example/1",
    });
    await store.createSession({
      userId: id,
      tokenHash: hashSessionToken("valid"),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await store.createSession({
      userId: id,
      tokenHash: hashSessionToken("expired"),
      expiresAt: now,
    });
  });

  describe("findSessionUser", () => {
    it("returns the admin owning an unexpired session, with its role", async () => {
      expect(await findSessionUser(deps, "valid")).toEqual({
        id: 1,
        githubLogin: "OctoCat",
        name: "The Octocat",
        avatarUrl: "https://avatars.example/1",
        role: "admin",
      });
    });

    it("returns a member with the member role", async () => {
      await store.addMember({ githubLogin: "mona", addedByUserId: 1 });
      await signIn(2, "Mona", "mona-token", new Date(now.getTime() + 60_000));

      expect(await findSessionUser(deps, "mona-token")).toMatchObject({
        githubLogin: "Mona",
        role: "member",
      });
    });

    it("returns undefined for an unknown token", async () => {
      expect(await findSessionUser(deps, "unknown")).toBeUndefined();
    });

    it("treats an expired session as absent and deletes it", async () => {
      expect(await findSessionUser(deps, "expired")).toBeUndefined();
      expect(store.sessions.map((s) => s.tokenHash)).toEqual([hashSessionToken("valid")]);
    });

    it("revokes every session of a user who lost access", async () => {
      const future = new Date(now.getTime() + 60_000);
      const mona = await signIn(2, "mona", "mona-1", future);
      await store.createSession({ userId: mona, tokenHash: hashSessionToken("mona-2"), expiresAt: future });

      expect(await findSessionUser(deps, "mona-1")).toBeUndefined();
      expect(store.sessions.filter((s) => s.userId === mona)).toEqual([]);
      expect(store.sessions.filter((s) => s.userId === 1)).toHaveLength(2);
    });

    it("revokes an admin's sessions once the admin is removed from configuration", async () => {
      expect(await findSessionUser({ ...deps, adminLogins: ["hubot"] }, "valid")).toBeUndefined();
      expect(store.sessions).toEqual([]);
    });
  });

  describe("endSession", () => {
    it("deletes only the session of the given token", async () => {
      await endSession(store, "valid");
      expect(store.sessions.map((s) => s.tokenHash)).toEqual([hashSessionToken("expired")]);
    });

    it("is a no-op for an unknown token", async () => {
      await endSession(store, "unknown");
      expect(store.sessions).toHaveLength(2);
    });
  });
});

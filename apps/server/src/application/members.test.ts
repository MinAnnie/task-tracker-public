import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthStore } from "../../test/fakes/in-memory-auth-store.ts";
import type { SessionUser } from "./auth-store.ts";
import { addMember, listMembers, removeMember, type MembersDeps } from "./members.ts";
import { hashSessionToken } from "./session-token.ts";

const createdAt = new Date("2026-03-01T12:00:00Z");
const future = new Date("2027-01-01T00:00:00Z");

describe("members", () => {
  let store: InMemoryAuthStore;
  let deps: MembersDeps;
  let admin: SessionUser;

  beforeEach(async () => {
    store = new InMemoryAuthStore();
    store.now = () => createdAt;
    deps = { store, adminLogins: ["octocat", "hubot"] };
    const { id } = await store.upsertUserByGithubId({
      githubId: 1,
      login: "OctoCat",
      name: null,
      avatarUrl: null,
    });
    admin = { id, githubLogin: "OctoCat", name: null, avatarUrl: null };
  });

  describe("listMembers", () => {
    it("lists configured admins separately from database members", async () => {
      await store.addMember({ githubLogin: "mona", addedByUserId: admin.id });
      await store.addMember({ githubLogin: "bob", addedByUserId: null });

      expect(await listMembers(deps)).toEqual({
        admins: ["octocat", "hubot"],
        members: [
          { githubLogin: "bob", createdAt, addedBy: null },
          { githubLogin: "mona", createdAt, addedBy: "OctoCat" },
        ],
      });
    });
  });

  describe("addMember", () => {
    it("stores a valid login lowercased, recording who added it", async () => {
      const result = await addMember(deps, { githubLogin: "Mona-Lisa", actor: admin });

      expect(result).toEqual({
        status: "created",
        member: { githubLogin: "mona-lisa", createdAt, addedBy: "OctoCat" },
      });
      expect(store.members).toEqual([
        expect.objectContaining({ githubLogin: "mona-lisa", addedByUserId: admin.id }),
      ]);
    });

    it.each([["-mona"], [""], ["a".repeat(40)], [42], [undefined]])(
      "rejects the invalid login %j",
      async (githubLogin) => {
        expect(await addMember(deps, { githubLogin, actor: admin })).toEqual({
          status: "invalid_login",
        });
        expect(store.members).toEqual([]);
      },
    );

    it("rejects a configured admin, who already has access", async () => {
      expect(await addMember(deps, { githubLogin: "HUBOT", actor: admin })).toEqual({
        status: "already_admin",
        githubLogin: "hubot",
      });
      expect(store.members).toEqual([]);
    });

    it("reports an existing member without changing it", async () => {
      await store.addMember({ githubLogin: "mona", addedByUserId: null });

      expect(await addMember(deps, { githubLogin: "Mona", actor: admin })).toEqual({
        status: "already_member",
        githubLogin: "mona",
      });
      expect(store.members).toHaveLength(1);
      expect(store.members[0]?.addedByUserId).toBeNull();
    });
  });

  describe("removeMember", () => {
    it("deletes the member and every session of matching users, case-insensitively", async () => {
      await store.addMember({ githubLogin: "mona", addedByUserId: admin.id });
      const { id: mona } = await store.upsertUserByGithubId({
        githubId: 2,
        login: "Mona",
        name: null,
        avatarUrl: null,
      });
      await store.createSession({ userId: mona, tokenHash: hashSessionToken("m1"), expiresAt: future });
      await store.createSession({ userId: mona, tokenHash: hashSessionToken("m2"), expiresAt: future });
      await store.createSession({
        userId: admin.id,
        tokenHash: hashSessionToken("a"),
        expiresAt: future,
      });

      expect(await removeMember(deps, "MONA")).toEqual({ status: "removed" });
      expect(store.members).toEqual([]);
      expect(store.sessions.map((s) => s.userId)).toEqual([admin.id]);
      expect(store.transactions).toBe(1);
    });

    it("unassigns the removed member's open tasks across all projects in the same transaction", async () => {
      await store.addMember({ githubLogin: "mona", addedByUserId: null });
      const { id: mona } = await store.upsertUserByGithubId({
        githubId: 2,
        login: "Mona",
        name: null,
        avatarUrl: null,
      });
      store.tasks.push(
        { id: 1, projectId: 1, status: "todo", assigneeId: mona },
        { id: 2, projectId: 2, status: "blocked", assigneeId: mona },
        { id: 3, projectId: 1, status: "done", assigneeId: mona },
        { id: 4, projectId: 1, status: "todo", assigneeId: admin.id },
      );

      expect(await removeMember(deps, "mona")).toEqual({ status: "removed" });
      expect(store.tasks.map((t) => [t.id, t.assigneeId])).toEqual([
        [1, null],
        [2, null],
        [3, mona],
        [4, admin.id],
      ]);
      expect(store.transactions).toBe(1);
    });

    it("moves the removed member's in-progress tasks back to todo and keeps review and blocked statuses", async () => {
      await store.addMember({ githubLogin: "mona", addedByUserId: null });
      const { id: mona } = await store.upsertUserByGithubId({
        githubId: 2,
        login: "Mona",
        name: null,
        avatarUrl: null,
      });
      store.tasks.push(
        { id: 1, projectId: 1, status: "in_progress", assigneeId: mona },
        { id: 2, projectId: 2, status: "in_review", assigneeId: mona },
        { id: 3, projectId: 2, status: "blocked", assigneeId: mona },
        { id: 4, projectId: 1, status: "in_progress", assigneeId: admin.id },
      );

      expect(await removeMember(deps, "mona")).toEqual({ status: "removed" });
      expect(store.tasks.map((t) => [t.id, t.status, t.assigneeId])).toEqual([
        [1, "todo", null],
        [2, "in_review", null],
        [3, "blocked", null],
        [4, "in_progress", admin.id],
      ]);
      expect(store.transactions).toBe(1);
    });

    it("reports an absent member without touching sessions", async () => {
      await store.createSession({
        userId: admin.id,
        tokenHash: hashSessionToken("a"),
        expiresAt: future,
      });
      expect(await removeMember(deps, "ghost")).toEqual({ status: "not_found" });
      expect(await removeMember(deps, "not a login")).toEqual({ status: "not_found" });
      expect(store.sessions).toHaveLength(1);
    });

    it("keeps the sessions of a configured admin whose stale member row is removed", async () => {
      await store.addMember({ githubLogin: "octocat", addedByUserId: null });
      await store.createSession({
        userId: admin.id,
        tokenHash: hashSessionToken("a"),
        expiresAt: future,
      });
      store.tasks.push({ id: 1, projectId: 1, status: "todo", assigneeId: admin.id });

      expect(await removeMember(deps, "octocat")).toEqual({ status: "removed" });
      expect(store.sessions).toHaveLength(1);
      expect(store.tasks[0]?.assigneeId).toBe(admin.id);
    });
  });
});

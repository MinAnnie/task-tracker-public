import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryApiTokenStore } from "../../test/fakes/in-memory-api-token-store.ts";
import {
  authenticateApiToken,
  createApiToken,
  createPersonalApiToken,
  generateApiToken,
  hashApiToken,
  listApiTokens,
  listPersonalApiTokens,
  resolveApiTokenActor,
  revokeApiToken,
  revokePersonalApiToken,
  type ProjectApiTokenCaller,
  type ApiTokensDeps,
} from "./api-tokens.ts";
import type { AuthenticatedUser } from "./sessions.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const admin: AuthenticatedUser = { id: 1, githubLogin: "OctoCat", name: null, avatarUrl: null, role: "admin" };
const mona: AuthenticatedUser = { id: 7, githubLogin: "Mona", name: "Mona", avatarUrl: null, role: "member" };
const shop = { id: 3, slug: "shop", name: "Shop", taskKeyPrefix: "RF", discordInviteUrl: null };
const blog = { id: 4, slug: "blog", name: "Blog", taskKeyPrefix: "BL", discordInviteUrl: null };
const NOW = new Date("2026-05-01T12:00:00Z");
const TOKEN = `ttk_${"a".repeat(43)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("API tokens", () => {
  let store: InMemoryApiTokenStore;
  let clock: Date;
  let deps: ApiTokensDeps;
  let members: Set<string>;

  beforeEach(() => {
    store = new InMemoryApiTokenStore();
    store.projects.push(shop, blog);
    store.users.push(
      { id: admin.id, githubLogin: "octocat", name: "Octo", avatarUrl: null },
      { id: mona.id, githubLogin: "Mona", name: "Mona", avatarUrl: null },
    );
    clock = NOW;
    store.now = () => clock;
    members = new Set(["mona"]);
    deps = {
      store,
      now: () => clock,
      generateToken: () => TOKEN,
      adminLogins: ["octocat"],
      isMember: async (login) => members.has(login),
    };
  });

  describe("generateApiToken / hashApiToken", () => {
    it("generates ttk_ + 32 random bytes in base64url", () => {
      const token = generateApiToken();
      expect(token).toMatch(/^ttk_[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token.slice(4), "base64url")).toHaveLength(32);
      expect(generateApiToken()).not.toBe(token);
    });

    it("hashes with hex SHA-256", () => {
      expect(hashApiToken(TOKEN)).toBe(sha256(TOKEN));
    });
  });

  describe("createApiToken", () => {
    it("returns the secret once and stores only its hash and prefix", async () => {
      const result = await createApiToken(deps, "SHOP", { name: "  VPS agent ", expiresInDays: 90 }, admin);

      expect(result).toEqual({
        status: "created",
        token: TOKEN,
        apiToken: {
          id: 1,
          name: "VPS agent",
          prefix: "aaaaaaaa",
          scope: "read",
          createdAt: NOW,
          createdBy: "octocat",
          lastUsedAt: null,
          expiresAt: new Date(NOW.getTime() + 90 * DAY_MS),
          revokedAt: null,
          status: "active",
        },
      });
      const [stored] = store.tokens;
      expect(stored).toMatchObject({ projectId: shop.id, tokenHash: sha256(TOKEN), tokenPrefix: "aaaaaaaa" });
      expect(JSON.stringify(store.tokens)).not.toContain(TOKEN);
    });

    it("creates tokens that never expire with expiresInDays null or absent", async () => {
      await createApiToken(deps, "shop", { name: "A", expiresInDays: null }, admin);
      deps.generateToken = () => `ttk_${"b".repeat(43)}`;
      await createApiToken(deps, "shop", { name: "B" }, admin);
      expect(store.tokens.map((t) => t.expiresAt)).toEqual([null, null]);
    });

    it.each([
      [null, "body"],
      [[], "body"],
      [{ name: "" }, "name"],
      [{ name: "x".repeat(61) }, "name"],
      [{ name: "A", expiresInDays: 0 }, "expiresInDays"],
      [{ name: "A", expiresInDays: 366 }, "expiresInDays"],
      [{ name: "A", scope: "admin" }, "scope"],
      [{ name: "A", scope: null }, "scope"],
    ])("rejects %j as invalid %s", async (body, field) => {
      expect(await createApiToken(deps, "shop", body, admin)).toEqual({ status: "invalid", field });
      expect(store.tokens).toEqual([]);
    });

    it("creates a write token on request", async () => {
      const result = await createApiToken(deps, "shop", { name: "Agent", scope: "write" }, admin);
      expect(result).toMatchObject({ status: "created", apiToken: { scope: "write" } });
      expect(store.tokens[0]?.scope).toBe("write");
    });

    it("reports an unknown project", async () => {
      expect(await createApiToken(deps, "ghost", { name: "A" }, admin)).toEqual({ status: "project_not_found" });
    });
  });

  describe("listApiTokens", () => {
    it("lists the project's tokens, newest first, with their status", async () => {
      await createApiToken(deps, "shop", { name: "Old", expiresInDays: 1 }, admin);
      clock = new Date(NOW.getTime() + 2 * DAY_MS);
      deps.generateToken = () => `ttk_${"b".repeat(43)}`;
      await createApiToken(deps, "shop", { name: "New" }, admin);
      deps.generateToken = () => `ttk_${"c".repeat(43)}`;
      await createApiToken(deps, "blog", { name: "Other" }, admin);

      const result = await listApiTokens(deps, "shop");

      expect(result.status === "ok" && result.tokens.map((t) => [t.name, t.status])).toEqual([
        ["New", "active"],
        ["Old", "expired"],
      ]);
      expect(JSON.stringify(result)).not.toMatch(/tokenHash|ttk_/);
    });

    it("reports an unknown project", async () => {
      expect(await listApiTokens(deps, "ghost")).toEqual({ status: "project_not_found" });
    });
  });

  describe("revokeApiToken", () => {
    beforeEach(async () => {
      await createApiToken(deps, "shop", { name: "A" }, admin);
    });

    it("revokes the token, idempotently keeping the first revocation time", async () => {
      expect(await revokeApiToken(deps, "shop", "1")).toEqual({ status: "revoked" });
      clock = new Date(NOW.getTime() + 1000);
      expect(await revokeApiToken(deps, "shop", "1")).toEqual({ status: "revoked" });
      expect(store.tokens[0]?.revokedAt).toEqual(NOW);
    });

    it.each([["2"], ["abc"], ["1.5"], ["-1"], ["99999999999"]])("reports token %j as not found", async (id) => {
      expect(await revokeApiToken(deps, "shop", id)).toEqual({ status: "token_not_found" });
    });

    it("does not revoke a token through another project", async () => {
      expect(await revokeApiToken(deps, "blog", "1")).toEqual({ status: "token_not_found" });
      expect(store.tokens[0]?.revokedAt).toBeNull();
    });

    it("reports an unknown project", async () => {
      expect(await revokeApiToken(deps, "ghost", "1")).toEqual({ status: "project_not_found" });
    });
  });

  describe("personal tokens", () => {
    it("creates a read token owned by the caller, with no project", async () => {
      const result = await createPersonalApiToken(deps, { name: " Laptop ", expiresInDays: 30 }, mona);

      expect(result).toEqual({
        status: "created",
        token: TOKEN,
        apiToken: {
          id: 1,
          name: "Laptop",
          prefix: "aaaaaaaa",
          scope: "read",
          createdAt: NOW,
          createdBy: "Mona",
          lastUsedAt: null,
          expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
          revokedAt: null,
          status: "active",
        },
      });
      expect(store.tokens[0]).toMatchObject({ projectId: null, ownerUserId: mona.id, createdByUserId: mona.id });
    });

    it("refuses a write token to a member", async () => {
      expect(await createPersonalApiToken(deps, { name: "Agent", scope: "write" }, mona)).toEqual({
        status: "scope_not_allowed",
      });
      expect(store.tokens).toEqual([]);
    });

    it("lets an admin create a write token", async () => {
      const result = await createPersonalApiToken(deps, { name: "Agent", scope: "write" }, admin);
      expect(result).toMatchObject({ status: "created", apiToken: { scope: "write" } });
    });

    it.each([
      [null, "body"],
      [{ name: "" }, "name"],
      [{ name: "A", expiresInDays: 0 }, "expiresInDays"],
      [{ name: "A", scope: "admin" }, "scope"],
    ])("rejects %j as invalid %s", async (body, field) => {
      expect(await createPersonalApiToken(deps, body, mona)).toEqual({ status: "invalid", field });
    });

    it("lists only the caller's own personal tokens, never project tokens", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      deps.generateToken = () => `ttk_${"b".repeat(43)}`;
      await createPersonalApiToken(deps, { name: "Admin's" }, admin);
      deps.generateToken = () => `ttk_${"c".repeat(43)}`;
      await createApiToken(deps, "shop", { name: "Project" }, mona);

      expect((await listPersonalApiTokens(deps, mona)).map((t) => t.name)).toEqual(["Mine"]);
      expect((await listPersonalApiTokens(deps, admin)).map((t) => t.name)).toEqual(["Admin's"]);
      const project = await listApiTokens(deps, "shop");
      expect(project.status === "ok" && project.tokens.map((t) => t.name)).toEqual(["Project"]);
    });

    it("revokes only the caller's own personal tokens", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      deps.generateToken = () => `ttk_${"c".repeat(43)}`;
      await createApiToken(deps, "shop", { name: "Project" }, mona);

      expect(await revokePersonalApiToken(deps, admin, "1")).toEqual({ status: "token_not_found" });
      expect(await revokePersonalApiToken(deps, mona, "2")).toEqual({ status: "token_not_found" });
      expect(await revokePersonalApiToken(deps, mona, "abc")).toEqual({ status: "token_not_found" });
      expect(store.tokens.map((t) => t.revokedAt)).toEqual([null, null]);

      expect(await revokePersonalApiToken(deps, mona, "1")).toEqual({ status: "revoked" });
      expect(store.tokens[0]?.revokedAt).toEqual(NOW);
    });

    it("does not let project token management touch personal tokens", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      expect(await revokeApiToken(deps, "shop", "1")).toEqual({ status: "token_not_found" });
      expect(store.tokens[0]?.revokedAt).toBeNull();
    });

    it("authenticates as the owner with their current role", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      expect(await authenticateApiToken(deps, TOKEN)).toEqual({
        kind: "api_token",
        tokenId: 1,
        projectId: null,
        project: null,
        scope: "read",
        creator: { id: mona.id, githubLogin: "Mona", name: "Mona", avatarUrl: null },
        owner: { id: mona.id, githubLogin: "Mona", name: "Mona", avatarUrl: null, role: "member" },
      });
    });

    it("authenticates an admin's token as an admin", async () => {
      await createPersonalApiToken(deps, { name: "Mine", scope: "write" }, admin);
      expect(await authenticateApiToken(deps, TOKEN)).toMatchObject({ scope: "write", owner: { role: "admin" } });
    });

    it("rejects the token once its owner has no role any more", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      members.clear();
      expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
    });
  });

  describe("authenticateApiToken", () => {
    beforeEach(async () => {
      await createApiToken(deps, "shop", { name: "A", expiresInDays: 30 }, admin);
    });

    it("resolves a valid token to its project-scoped caller, with its scope and creator", async () => {
      expect(await authenticateApiToken(deps, TOKEN)).toEqual({
        kind: "api_token",
        tokenId: 1,
        projectId: shop.id,
        project: shop,
        scope: "read",
        creator: { id: admin.id, githubLogin: "octocat", name: "Octo", avatarUrl: null },
      });
    });

    it("resolves write tokens too, and a creator who is gone as null", async () => {
      deps.generateToken = () => `ttk_${"w".repeat(43)}`;
      await createApiToken(deps, "shop", { name: "W", scope: "write" }, admin);
      store.users = [];
      expect(await authenticateApiToken(deps, `ttk_${"w".repeat(43)}`)).toMatchObject({ scope: "write", creator: null });
    });

    it.each([
      ["unknown", `ttk_${"z".repeat(43)}`],
      ["malformed", "not-a-token"],
      ["empty", ""],
    ])("rejects an %s token", async (_, token) => {
      expect(await authenticateApiToken(deps, token)).toBeUndefined();
    });

    it("rejects a revoked token", async () => {
      await revokeApiToken(deps, "shop", "1");
      expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
    });

    it("rejects an expired token", async () => {
      clock = new Date(NOW.getTime() + 30 * DAY_MS);
      expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
    });

    it("records last use at most once per minute", async () => {
      await authenticateApiToken(deps, TOKEN);
      expect(store.tokens[0]?.lastUsedAt).toEqual(NOW);

      clock = new Date(NOW.getTime() + 59_000);
      await authenticateApiToken(deps, TOKEN);
      expect(store.touches).toBe(1);
      expect(store.tokens[0]?.lastUsedAt).toEqual(NOW);

      clock = new Date(NOW.getTime() + 60_000);
      await authenticateApiToken(deps, TOKEN);
      expect(store.touches).toBe(2);
      expect(store.tokens[0]?.lastUsedAt).toEqual(clock);
    });

    it("does not record use of a rejected token", async () => {
      await revokeApiToken(deps, "shop", "1");
      await authenticateApiToken(deps, TOKEN);
      expect(store.touches).toBe(0);
    });
  });

  describe("resolveApiTokenActor", () => {
    const creator = { id: 7, githubLogin: "Mona", name: "Mona", avatarUrl: null };
    const caller = (overrides: Partial<ProjectApiTokenCaller> = {}): ProjectApiTokenCaller => ({
      kind: "api_token",
      tokenId: 1,
      projectId: shop.id,
      project: shop,
      scope: "write",
      creator,
      ...overrides,
    });
    const actorDeps = { adminLogins: ["octocat"], isMember: async (login: string) => login === "mona" };

    it("acts as the creator with their current role", async () => {
      expect(await resolveApiTokenActor(actorDeps, caller())).toEqual({ ...creator, role: "member" });
      expect(
        await resolveApiTokenActor(actorDeps, caller({ creator: { ...creator, githubLogin: "OctoCat" } })),
      ).toEqual({ ...creator, githubLogin: "OctoCat", role: "admin" });
    });

    it("finds no actor once the creator lost every role or is gone", async () => {
      expect(await resolveApiTokenActor(actorDeps, caller({ creator: { ...creator, githubLogin: "eve" } }))).toBeUndefined();
      expect(await resolveApiTokenActor(actorDeps, caller({ creator: null }))).toBeUndefined();
    });
  });
});

import { sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import {
  authenticateApiToken,
  createApiToken,
  createPersonalApiToken,
  hashApiToken,
  listApiTokens,
  listPersonalApiTokens,
  revokeApiToken,
  revokePersonalApiToken,
  type ApiTokensDeps,
} from "../application/api-tokens.ts";
import type { AuthenticatedUser } from "../application/sessions.ts";
import { createDb } from "../db/client.ts";
import { apiTokens, projects, users } from "../db/schema.ts";
import { createDrizzleApiTokenStore } from "./drizzle-api-token-store.ts";

const { sql, db } = createDb(testDatabaseUrl);
const store = createDrizzleApiTokenStore(db);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const TOKEN = `ttk_${"Q".repeat(43)}`;
const NOW = new Date("2026-05-01T12:00:00.000Z");

describe("createDrizzleApiTokenStore (Postgres)", () => {
  let admin: AuthenticatedUser;
  let mona: AuthenticatedUser;
  let members: Set<string>;
  let shopId: number;
  let clock: Date;
  let deps: ApiTokensDeps;

  beforeEach(async () => {
    await db.execute(
      rawSql`truncate table api_tokens, members, sessions, task_pull_requests, pull_requests, tasks, repositories, users, projects restart identity cascade`,
    );
    const [user] = await db.insert(users).values({ githubId: 1, githubLogin: "OctoCat" }).returning();
    admin = { id: user!.id, githubLogin: "OctoCat", name: null, avatarUrl: null, role: "admin" };
    const [member] = await db.insert(users).values({ githubId: 2, githubLogin: "Mona", name: "Mona" }).returning();
    mona = { id: member!.id, githubLogin: "Mona", name: "Mona", avatarUrl: null, role: "member" };
    members = new Set(["mona"]);
    const [shop] = await db.insert(projects).values({ slug: "shop", name: "Shop", taskKeyPrefix: "RF" }).returning();
    await db.insert(projects).values({ slug: "blog", name: "Blog", taskKeyPrefix: "BL" });
    shopId = shop!.id;
    clock = NOW;
    deps = {
      store,
      now: () => clock,
      generateToken: () => TOKEN,
      adminLogins: ["octocat"],
      isMember: async (login) => members.has(login),
    };
  });

  it("stores only the hash and prefix of a created token", async () => {
    const result = await createApiToken(deps, "shop", { name: "VPS", expiresInDays: 30 }, admin);
    expect(result).toMatchObject({ status: "created", token: TOKEN, apiToken: { createdBy: "OctoCat" } });

    const rows = await db.select().from(apiTokens);
    expect(rows).toEqual([
      expect.objectContaining({
        projectId: shopId,
        name: "VPS",
        tokenHash: hashApiToken(TOKEN),
        tokenPrefix: "QQQQQQQQ",
        scope: "read",
        createdByUserId: admin.id,
        expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
        lastUsedAt: null,
        revokedAt: null,
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
  });

  it("rejects a duplicate token hash", async () => {
    await createApiToken(deps, "shop", { name: "A" }, admin);
    await expect(createApiToken(deps, "shop", { name: "B" }, admin)).rejects.toThrow();
  });

  it("lists a project's tokens newest first", async () => {
    await createApiToken(deps, "shop", { name: "Old" }, admin);
    await db.update(apiTokens).set({ createdAt: new Date("2026-01-01T00:00:00Z") });
    await createApiToken({ ...deps, generateToken: () => `ttk_${"R".repeat(43)}` }, "shop", { name: "New" }, admin);
    await createApiToken({ ...deps, generateToken: () => `ttk_${"S".repeat(43)}` }, "blog", { name: "Blog" }, admin);

    const result = await listApiTokens(deps, "shop");
    expect(result.status === "ok" && result.tokens.map((t) => t.name)).toEqual(["New", "Old"]);
  });

  it("keeps tokens when their creator is deleted, and deletes them with their project", async () => {
    await createApiToken(deps, "shop", { name: "A" }, admin);
    await db.delete(users);
    const result = await listApiTokens(deps, "shop");
    expect(result.status === "ok" && result.tokens[0]?.createdBy).toBeNull();

    await db.delete(projects);
    expect(await db.select().from(apiTokens)).toEqual([]);
  });

  it("revokes idempotently and only within the token's project", async () => {
    await createApiToken(deps, "shop", { name: "A" }, admin);
    const [{ id } = { id: 0 }] = await db.select({ id: apiTokens.id }).from(apiTokens);

    expect(await revokeApiToken(deps, "blog", String(id))).toEqual({ status: "token_not_found" });
    expect(await revokeApiToken(deps, "shop", String(id))).toEqual({ status: "revoked" });
    clock = new Date(NOW.getTime() + 5000);
    expect(await revokeApiToken(deps, "shop", String(id))).toEqual({ status: "revoked" });

    const [row] = await db.select().from(apiTokens);
    expect(row?.revokedAt).toEqual(NOW);
    expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
  });

  it("authenticates a token to its project and throttles last_used_at", async () => {
    await createApiToken(deps, "shop", { name: "A" }, admin);

    expect(await authenticateApiToken(deps, TOKEN)).toEqual({
      kind: "api_token",
      tokenId: expect.any(Number),
      projectId: shopId,
      project: { id: shopId, slug: "shop", name: "Shop", taskKeyPrefix: "RF", discordInviteUrl: null },
      scope: "read",
      creator: { id: admin.id, githubLogin: "OctoCat", name: null, avatarUrl: null },
    });
    clock = new Date(NOW.getTime() + 30_000);
    await authenticateApiToken(deps, TOKEN);
    expect((await db.select().from(apiTokens))[0]?.lastUsedAt).toEqual(NOW);

    clock = new Date(NOW.getTime() + 61_000);
    await authenticateApiToken(deps, TOKEN);
    expect((await db.select().from(apiTokens))[0]?.lastUsedAt).toEqual(clock);
  });

  it("does not move last_used_at backwards or within the window on a concurrent touch", async () => {
    await createApiToken(deps, "shop", { name: "A" }, admin);
    const [{ id } = { id: 0 }] = await db.select({ id: apiTokens.id }).from(apiTokens);
    await store.touchToken(id, NOW, new Date(NOW.getTime() - 60_000));
    await store.touchToken(id, new Date(NOW.getTime() + 1000), new Date(NOW.getTime() - 59_000));
    expect((await db.select().from(apiTokens))[0]?.lastUsedAt).toEqual(NOW);
  });

  it("stores write tokens and resolves them with their creator, or null once the creator is gone", async () => {
    await createApiToken(deps, "shop", { name: "Agent", scope: "write" }, admin);
    expect((await db.select({ scope: apiTokens.scope }).from(apiTokens))[0]?.scope).toBe("write");
    expect(await authenticateApiToken(deps, TOKEN)).toMatchObject({ scope: "write", creator: { id: admin.id } });

    await db.delete(users);
    expect(await authenticateApiToken(deps, TOKEN)).toMatchObject({ scope: "write", creator: null });
  });

  it("only stores known scopes", async () => {
    await expect(
      db.insert(apiTokens).values({ projectId: shopId, name: "x", tokenHash: "h", tokenPrefix: "p", scope: "admin" as "read" }),
    ).rejects.toThrow();
  });

  it("rejects expired tokens", async () => {
    await createApiToken(deps, "shop", { name: "A", expiresInDays: 1 }, admin);
    clock = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
  });

  describe("personal tokens", () => {
    const OTHER = `ttk_${"P".repeat(43)}`;

    it("stores a personal token with its owner and no project", async () => {
      await createPersonalApiToken(deps, { name: "Laptop" }, mona);
      expect(await db.select().from(apiTokens)).toEqual([
        expect.objectContaining({ projectId: null, ownerUserId: mona.id, createdByUserId: mona.id, scope: "read" }),
      ]);
    });

    it("refuses a token with both or neither of a project and an owner", async () => {
      const row = { name: "x", tokenHash: "h", tokenPrefix: "p" };
      await expect(db.insert(apiTokens).values(row)).rejects.toThrow();
      await expect(db.insert(apiTokens).values({ ...row, projectId: shopId, ownerUserId: mona.id })).rejects.toThrow();
    });

    it("lists only the owner's personal tokens, and project lists never show them", async () => {
      await createPersonalApiToken(deps, { name: "Old" }, mona);
      await db.update(apiTokens).set({ createdAt: new Date("2026-01-01T00:00:00Z") });
      await createPersonalApiToken({ ...deps, generateToken: () => `ttk_${"R".repeat(43)}` }, { name: "New" }, mona);
      await createPersonalApiToken({ ...deps, generateToken: () => OTHER }, { name: "Admin" }, admin);
      await createApiToken({ ...deps, generateToken: () => `ttk_${"S".repeat(43)}` }, "shop", { name: "Shop" }, mona);

      expect((await listPersonalApiTokens(deps, mona)).map((t) => [t.name, t.createdBy])).toEqual([
        ["New", "Mona"],
        ["Old", "Mona"],
      ]);
      const shop = await listApiTokens(deps, "shop");
      expect(shop.status === "ok" && shop.tokens.map((t) => t.name)).toEqual(["Shop"]);
    });

    it("revokes only the owner's tokens, idempotently", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      await createApiToken({ ...deps, generateToken: () => OTHER }, "shop", { name: "Shop" }, mona);
      const ids = (await db.select({ id: apiTokens.id }).from(apiTokens).orderBy(apiTokens.id)).map((r) => r.id);

      expect(await revokePersonalApiToken(deps, admin, String(ids[0]))).toEqual({ status: "token_not_found" });
      expect(await revokePersonalApiToken(deps, mona, String(ids[1]))).toEqual({ status: "token_not_found" });
      expect(await revokeApiToken(deps, "shop", String(ids[0]))).toEqual({ status: "token_not_found" });
      expect(await revokePersonalApiToken(deps, mona, String(ids[0]))).toEqual({ status: "revoked" });
      clock = new Date(NOW.getTime() + 5000);
      expect(await revokePersonalApiToken(deps, mona, String(ids[0]))).toEqual({ status: "revoked" });

      const rows = await db.select({ revokedAt: apiTokens.revokedAt }).from(apiTokens).orderBy(apiTokens.id);
      expect(rows.map((r) => r.revokedAt)).toEqual([NOW, null]);
      expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
    });

    it("authenticates as the owner with their current role, until they lose it", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      expect(await authenticateApiToken(deps, TOKEN)).toEqual({
        kind: "api_token",
        tokenId: expect.any(Number),
        projectId: null,
        project: null,
        scope: "read",
        creator: { id: mona.id, githubLogin: "Mona", name: "Mona", avatarUrl: null },
        owner: { id: mona.id, githubLogin: "Mona", name: "Mona", avatarUrl: null, role: "member" },
      });

      members.clear();
      expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
    });

    it("deletes personal tokens with their owner", async () => {
      await createPersonalApiToken(deps, { name: "Mine" }, mona);
      await db.delete(users);
      expect(await db.select().from(apiTokens)).toEqual([]);
    });
  });
});

import { sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import {
  authenticateApiToken,
  createApiToken,
  hashApiToken,
  listApiTokens,
  revokeApiToken,
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
  let shopId: number;
  let clock: Date;
  let deps: ApiTokensDeps;

  beforeEach(async () => {
    await db.execute(
      rawSql`truncate table api_tokens, members, sessions, task_pull_requests, pull_requests, tasks, repositories, users, projects restart identity cascade`,
    );
    const [user] = await db.insert(users).values({ githubId: 1, githubLogin: "OctoCat" }).returning();
    admin = { id: user!.id, githubLogin: "OctoCat", name: null, avatarUrl: null, role: "admin" };
    const [shop] = await db.insert(projects).values({ slug: "shop", name: "Shop", taskKeyPrefix: "RF" }).returning();
    await db.insert(projects).values({ slug: "blog", name: "Blog", taskKeyPrefix: "BL" });
    shopId = shop!.id;
    clock = NOW;
    deps = { store, now: () => clock, generateToken: () => TOKEN };
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
        permission: "read",
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
      project: { id: shopId, slug: "shop", name: "Shop", taskKeyPrefix: "RF" },
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

  it("rejects expired tokens", async () => {
    await createApiToken(deps, "shop", { name: "A", expiresInDays: 1 }, admin);
    clock = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(await authenticateApiToken(deps, TOKEN)).toBeUndefined();
  });
});

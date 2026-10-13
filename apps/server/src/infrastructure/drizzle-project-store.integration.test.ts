import { eq, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import { removeMember } from "../application/members.ts";
import type { ProjectRecord } from "../application/project-store.ts";
import {
  addProjectMember,
  listVisibleProjects,
  removeProjectMember,
  updateProject,
} from "../application/projects.ts";
import { createDb } from "../db/client.ts";
import { members, projectMembers, projects, repositories, tasks, users } from "../db/schema.ts";
import { createDrizzleAuthStore } from "./drizzle-auth-store.ts";
import { createDrizzleProjectStore } from "./drizzle-project-store.ts";

const { sql, db } = createDb(testDatabaseUrl);
const store = createDrizzleProjectStore(db);
const authStore = createDrizzleAuthStore(db);
const adminLogins = ["octocat"];

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const newProject = (slug: string, taskKeyPrefix: string) => ({
  slug,
  name: slug.toUpperCase(),
  taskKeyPrefix,
  discordChannelId: null,
});

const seedProject = async (slug: string, taskKeyPrefix: string): Promise<ProjectRecord> => {
  const result = await store.createProject(newProject(slug, taskKeyPrefix));
  if (result.status !== "saved") throw new Error("seed failed");
  return result.project;
};

const seedMember = async (githubLogin: string) => {
  const [row] = await db.insert(members).values({ githubLogin }).returning({ id: members.id });
  return row!.id;
};

const seedUser = async (githubId: number, githubLogin: string) => {
  const [row] = await db.insert(users).values({ githubId, githubLogin }).returning({ id: users.id });
  return row!.id;
};

const statuses = async () =>
  (await db.select({ key: tasks.key, status: tasks.status }).from(tasks).orderBy(tasks.key)).map(
    (t) => [t.key, t.status],
  );

const assignees = async () =>
  (await db.select({ key: tasks.key, assigneeId: tasks.assigneeId }).from(tasks).orderBy(tasks.key)).map(
    (t) => [t.key, t.assigneeId],
  );

describe("createDrizzleProjectStore (Postgres)", () => {
  beforeEach(async () => {
    await db.execute(
      rawSql`truncate table project_members, members, sessions, task_pull_requests, pull_requests, tasks, repositories, users, projects restart identity cascade`,
    );
  });

  describe("projects", () => {
    it("creates a project with defaults and finds it by slug", async () => {
      const result = await store.createProject({ ...newProject("shop", "RF"), discordChannelId: "123456789012345678" });

      expect(result).toEqual({
        status: "saved",
        project: {
          id: expect.any(Number),
          slug: "shop",
          name: "SHOP",
          taskKeyPrefix: "RF",
          discordChannelId: "123456789012345678",
          createdAt: expect.any(Date),
        },
      });
      if (result.status !== "saved") return;
      expect(await store.findProjectBySlug("shop")).toEqual(result.project);
      expect(await store.findProjectBySlug("ghost")).toBeUndefined();
      const [row] = await db.select({ next: projects.nextTaskNumber }).from(projects);
      expect(row?.next).toBe(1);
    });

    it("reports which unique column a create or update collides with", async () => {
      const shop = await seedProject("shop", "RF");
      await seedProject("blog", "BL");

      expect(await store.createProject(newProject("shop", "XX"))).toEqual({ status: "conflict", field: "slug" });
      expect(await store.createProject(newProject("other", "RF"))).toEqual({
        status: "conflict",
        field: "taskKeyPrefix",
      });
      expect(await store.updateProject(shop.id, { slug: "blog" })).toEqual({ status: "conflict", field: "slug" });
      expect(await store.updateProject(shop.id, { taskKeyPrefix: "BL" })).toEqual({
        status: "conflict",
        field: "taskKeyPrefix",
      });
      expect(await db.select().from(projects)).toHaveLength(2);
    });

    it("reports conflicts from inside the use case's transaction and keeps the project intact", async () => {
      await seedProject("shop", "RF");
      await seedProject("blog", "BL");

      expect(await updateProject({ store, adminLogins }, "shop", { slug: "blog" })).toEqual({
        status: "slug_taken",
      });
      expect(await updateProject({ store, adminLogins }, "shop", { taskKeyPrefix: "bl" })).toEqual({
        status: "prefix_taken",
      });
      expect(await store.findProjectBySlug("shop")).toMatchObject({ taskKeyPrefix: "RF" });
    });

    it("enforces the task key prefix format in the database", async () => {
      await expect(db.insert(projects).values({ slug: "x", name: "X", taskKeyPrefix: "rf" })).rejects.toThrow();
      await expect(db.insert(projects).values({ slug: "y", name: "Y", taskKeyPrefix: "1RF" })).rejects.toThrow();
    });

    it("finds the project of a Discord channel, the first by slug when several share it", async () => {
      const shop = await seedProject("shop", "RF");
      const blog = await seedProject("blog", "BL");
      await seedProject("docs", "DC");
      await store.updateProject(shop.id, { discordChannelId: "123456789012345678" });

      expect(await store.findProjectByDiscordChannelId("123456789012345678")).toEqual({
        ...shop,
        discordChannelId: "123456789012345678",
      });
      expect(await store.findProjectByDiscordChannelId("999")).toBeUndefined();

      await store.updateProject(blog.id, { discordChannelId: "123456789012345678" });
      expect((await store.findProjectByDiscordChannelId("123456789012345678"))?.slug).toBe("blog");
    });

    it("updates only the given fields", async () => {
      const shop = await seedProject("shop", "RF");
      await store.updateProject(shop.id, { discordChannelId: "123456789012345678" });

      expect(await store.updateProject(shop.id, { name: "Shop 2", discordChannelId: null })).toEqual({
        status: "saved",
        project: { ...shop, name: "Shop 2", discordChannelId: null },
      });
    });

    it("lists projects with counts, ordered by slug", async () => {
      const shop = await seedProject("shop", "RF");
      await seedProject("blog", "BL");
      const mona = await seedMember("mona");
      const bob = await seedMember("bob");
      await store.addProjectMember(shop.id, mona);
      await store.addProjectMember(shop.id, bob);
      await store.addRepository(shop.id, "acme/shop");
      await db.insert(tasks).values([
        { projectId: shop.id, key: "RF-1", title: "a" },
        { projectId: shop.id, key: "RF-2", title: "b" },
        { projectId: shop.id, key: "RF-3", title: "c" },
      ]);

      expect(await store.listProjects()).toEqual([
        expect.objectContaining({ slug: "blog", repositoryCount: 0, taskCount: 0, memberCount: 0 }),
        expect.objectContaining({ slug: "shop", repositoryCount: 1, taskCount: 3, memberCount: 2 }),
      ]);
      expect(await store.countProjectTasks(shop.id)).toBe(3);
    });

    it("deletes a project with its repositories, tasks and memberships", async () => {
      const shop = await seedProject("shop", "RF");
      await store.addRepository(shop.id, "acme/shop");
      await store.addProjectMember(shop.id, await seedMember("mona"));
      await db.insert(tasks).values({ projectId: shop.id, key: "RF-1", title: "a" });

      await store.deleteProject(shop.id);

      expect(await db.select().from(projects)).toEqual([]);
      expect(await db.select().from(repositories)).toEqual([]);
      expect(await db.select().from(tasks)).toEqual([]);
      expect(await db.select().from(projectMembers)).toEqual([]);
      expect(await db.select().from(members)).toHaveLength(1);
    });

    it("locks the prefix of a project with tasks through the use case", async () => {
      const shop = await seedProject("shop", "RF");
      await db.insert(tasks).values({ projectId: shop.id, key: "RF-1", title: "a" });

      expect(await updateProject({ store, adminLogins }, "shop", { taskKeyPrefix: "SH" })).toEqual({
        status: "prefix_locked",
      });
      expect(await updateProject({ store, adminLogins }, "shop", { slug: "shop-2", taskKeyPrefix: "rf" })).toMatchObject({
        status: "updated",
        project: { slug: "shop-2", taskKeyPrefix: "RF" },
      });
    });
  });

  describe("repositories", () => {
    it("links, lists and unlinks repositories of a project", async () => {
      const shop = await seedProject("shop", "RF");

      expect(await store.addRepository(shop.id, "acme/shop")).toEqual({
        fullName: "acme/shop",
        githubInstallationId: null,
      });
      await store.addRepository(shop.id, "acme/api");
      expect(await store.listProjectRepositories(shop.id)).toEqual([
        { fullName: "acme/api", githubInstallationId: null },
        { fullName: "acme/shop", githubInstallationId: null },
      ]);

      expect(await store.removeRepository(shop.id, "acme/shop")).toBe(true);
      expect(await store.removeRepository(shop.id, "acme/shop")).toBe(false);
      expect(await store.listProjectRepositories(shop.id)).toEqual([
        { fullName: "acme/api", githubInstallationId: null },
      ]);
    });

    it("refuses a repository already linked to any project", async () => {
      const shop = await seedProject("shop", "RF");
      const blog = await seedProject("blog", "BL");
      await store.addRepository(shop.id, "acme/shop");

      expect(await store.addRepository(blog.id, "acme/shop")).toBeUndefined();
      expect(await store.addRepository(shop.id, "acme/shop")).toBeUndefined();
      expect(await store.removeRepository(blog.id, "acme/shop")).toBe(false);
      expect(await db.select({ projectId: repositories.projectId }).from(repositories)).toEqual([
        { projectId: shop.id },
      ]);
    });
  });

  describe("project members", () => {
    it("adds, lists and removes project members", async () => {
      const shop = await seedProject("shop", "RF");
      const mona = await seedMember("mona");
      await seedMember("bob");

      expect(await store.findMemberIdByGithubLogin("mona")).toBe(mona);
      expect(await store.findMemberIdByGithubLogin("ghost")).toBeUndefined();
      const created = await store.addProjectMember(shop.id, mona);
      expect(created?.createdAt).toBeInstanceOf(Date);
      expect(await store.addProjectMember(shop.id, mona)).toBeUndefined();
      expect(await store.listProjectMembers(shop.id)).toEqual([
        { githubLogin: "mona", createdAt: created?.createdAt },
      ]);

      expect(await store.removeProjectMember(shop.id, "bob")).toBe(false);
      expect(await store.removeProjectMember(shop.id, "mona")).toBe(true);
      expect(await store.listProjectMembers(shop.id)).toEqual([]);
    });

    it("lists the projects visible to admins and members", async () => {
      const shop = await seedProject("shop", "RF");
      const blog = await seedProject("blog", "BL");
      await seedProject("api", "AP");
      const mona = await seedMember("mona");
      await store.addProjectMember(shop.id, mona);
      await store.addProjectMember(blog.id, mona);
      await seedMember("bob");

      const user = { id: 1, name: null, avatarUrl: null };
      expect(
        await listVisibleProjects({ store, adminLogins }, { ...user, githubLogin: "OctoCat", role: "admin" }),
      ).toEqual([
        { id: expect.any(Number), slug: "api", name: "API", taskKeyPrefix: "AP" },
        { id: blog.id, slug: "blog", name: "BLOG", taskKeyPrefix: "BL" },
        { id: shop.id, slug: "shop", name: "SHOP", taskKeyPrefix: "RF" },
      ]);
      expect(
        await listVisibleProjects({ store, adminLogins }, { ...user, githubLogin: "Mona", role: "member" }),
      ).toEqual([
        { id: blog.id, slug: "blog", name: "BLOG", taskKeyPrefix: "BL" },
        { id: shop.id, slug: "shop", name: "SHOP", taskKeyPrefix: "RF" },
      ]);
      expect(
        await listVisibleProjects({ store, adminLogins }, { ...user, githubLogin: "bob", role: "member" }),
      ).toEqual([]);
    });

    it("removes a project member, unassigns their open tasks in that project only and resets in-progress ones to todo", async () => {
      const shop = await seedProject("shop", "RF");
      const blog = await seedProject("blog", "BL");
      const mona = await seedMember("mona");
      await store.addProjectMember(shop.id, mona);
      await store.addProjectMember(blog.id, mona);
      const monaUser = await seedUser(2, "Mona");
      const bobUser = await seedUser(3, "bob");
      await db.insert(tasks).values([
        { projectId: shop.id, key: "RF-1", title: "a", status: "in_progress", assigneeId: monaUser },
        { projectId: shop.id, key: "RF-2", title: "b", status: "done", assigneeId: monaUser },
        { projectId: shop.id, key: "RF-3", title: "c", status: "todo", assigneeId: bobUser },
        { projectId: blog.id, key: "BL-1", title: "d", status: "todo", assigneeId: monaUser },
      ]);

      expect(await addProjectMember({ store, adminLogins }, "shop", "mona")).toEqual({
        status: "already_project_member",
      });
      expect(await removeProjectMember({ store, adminLogins }, "shop", "MONA")).toEqual({ status: "removed" });

      expect(await assignees()).toEqual([
        ["BL-1", monaUser],
        ["RF-1", null],
        ["RF-2", monaUser],
        ["RF-3", bobUser],
      ]);
      expect(await statuses()).toEqual([
        ["BL-1", "todo"],
        ["RF-1", "todo"],
        ["RF-2", "done"],
        ["RF-3", "todo"],
      ]);
      expect(await store.listProjectMembers(blog.id)).toEqual([
        { githubLogin: "mona", createdAt: expect.any(Date) },
      ]);
    });

    it("removing an app member drops their memberships, unassigns their open tasks everywhere and resets in-progress ones to todo", async () => {
      const shop = await seedProject("shop", "RF");
      const blog = await seedProject("blog", "BL");
      const mona = await seedMember("mona");
      await store.addProjectMember(shop.id, mona);
      await store.addProjectMember(blog.id, mona);
      const monaUser = await seedUser(2, "Mona");
      const bobUser = await seedUser(3, "bob");
      await db.insert(tasks).values([
        { projectId: shop.id, key: "RF-1", title: "a", status: "blocked", assigneeId: monaUser },
        { projectId: shop.id, key: "RF-2", title: "b", status: "done", assigneeId: monaUser },
        { projectId: blog.id, key: "BL-1", title: "c", status: "in_review", assigneeId: monaUser },
        { projectId: blog.id, key: "BL-2", title: "d", status: "todo", assigneeId: bobUser },
        { projectId: blog.id, key: "BL-3", title: "e", status: "in_progress", assigneeId: monaUser },
        { projectId: blog.id, key: "BL-4", title: "f", status: "in_progress", assigneeId: bobUser },
      ]);

      expect(await removeMember({ store: authStore, adminLogins }, "mona")).toEqual({ status: "removed" });

      expect(await db.select().from(projectMembers)).toEqual([]);
      expect(await assignees()).toEqual([
        ["BL-1", null],
        ["BL-2", bobUser],
        ["BL-3", null],
        ["BL-4", bobUser],
        ["RF-1", null],
        ["RF-2", monaUser],
      ]);
      expect(await statuses()).toEqual([
        ["BL-1", "in_review"],
        ["BL-2", "todo"],
        ["BL-3", "todo"],
        ["BL-4", "in_progress"],
        ["RF-1", "blocked"],
        ["RF-2", "done"],
      ]);
    });

    it("rolls back the membership removal when unassigning fails", async () => {
      const shop = await seedProject("shop", "RF");
      await store.addProjectMember(shop.id, await seedMember("mona"));

      await expect(
        store.transaction(async (tx) => {
          await tx.removeProjectMember(shop.id, "mona");
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await store.listProjectMembers(shop.id)).toHaveLength(1);
      expect(await db.select().from(projectMembers).where(eq(projectMembers.projectId, shop.id))).toHaveLength(1);
    });
  });
});

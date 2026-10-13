import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "../../test/fakes/in-memory-project-store.ts";
import type { ProjectRecord } from "./project-store.ts";
import {
  addProjectMember,
  addProjectRepository,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listVisibleProjects,
  removeProjectMember,
  removeProjectRepository,
  updateProject,
  type ProjectsDeps,
} from "./projects.ts";
import type { AuthenticatedUser } from "./sessions.ts";

const createdAt = new Date("2026-03-01T12:00:00Z");
const CHANNEL = "123456789012345678";

describe("projects", () => {
  let store: InMemoryProjectStore;
  let deps: ProjectsDeps;

  const seedProject = async (slug: string, taskKeyPrefix: string): Promise<ProjectRecord> => {
    const result = await store.createProject({
      slug,
      name: slug.toUpperCase(),
      taskKeyPrefix,
      discordChannelId: null,
    });
    if (result.status !== "saved") throw new Error("seed failed");
    return result.project;
  };

  beforeEach(() => {
    store = new InMemoryProjectStore();
    store.now = () => createdAt;
    deps = { store, adminLogins: ["octocat"] };
  });

  describe("listProjects", () => {
    it("lists projects with repository, task and member counts", async () => {
      const shop = await seedProject("shop", "RF");
      await seedProject("blog", "BL");
      store.members.push({ id: 7, githubLogin: "mona" });
      await store.addProjectMember(shop.id, 7);
      await store.addRepository(shop.id, "acme/shop");
      store.tasks.push({ id: 1, projectId: shop.id, status: "todo", assigneeId: null });

      expect(await listProjects(deps)).toEqual([
        expect.objectContaining({ slug: "blog", repositoryCount: 0, taskCount: 0, memberCount: 0 }),
        expect.objectContaining({ slug: "shop", repositoryCount: 1, taskCount: 1, memberCount: 1 }),
      ]);
    });
  });

  describe("listVisibleProjects", () => {
    const user = (githubLogin: string, role: "admin" | "member"): AuthenticatedUser => ({
      id: 1,
      githubLogin,
      name: null,
      avatarUrl: null,
      role,
    });

    beforeEach(async () => {
      const shop = await seedProject("shop", "RF");
      await seedProject("blog", "BL");
      store.members.push({ id: 7, githubLogin: "mona" });
      await store.addProjectMember(shop.id, 7);
    });

    it("shows every project to an admin", async () => {
      expect(await listVisibleProjects(deps, user("OctoCat", "admin"))).toEqual([
        { id: expect.any(Number), slug: "blog", name: "BLOG", taskKeyPrefix: "BL" },
        { id: expect.any(Number), slug: "shop", name: "SHOP", taskKeyPrefix: "RF" },
      ]);
    });

    it("shows a member only their projects, matching the login case-insensitively", async () => {
      expect(await listVisibleProjects(deps, user("Mona", "member"))).toEqual([
        { id: expect.any(Number), slug: "shop", name: "SHOP", taskKeyPrefix: "RF" },
      ]);
    });

    it("shows nothing to a member without projects", async () => {
      store.members.push({ id: 8, githubLogin: "bob" });
      expect(await listVisibleProjects(deps, user("bob", "member"))).toEqual([]);
    });
  });

  describe("createProject", () => {
    it("normalizes and stores a valid project", async () => {
      const result = await createProject(deps, {
        name: "  Web Shop ",
        slug: "Web-Shop",
        taskKeyPrefix: "rf",
        discordChannelId: CHANNEL,
      });

      expect(result).toEqual({
        status: "created",
        project: {
          id: expect.any(Number),
          slug: "web-shop",
          name: "Web Shop",
          taskKeyPrefix: "RF",
          discordChannelId: CHANNEL,
          createdAt,
        },
      });
    });

    it("defaults the Discord channel to null", async () => {
      const result = await createProject(deps, { name: "Shop", slug: "shop", taskKeyPrefix: "RF" });
      expect(result).toMatchObject({ status: "created", project: { discordChannelId: null } });
    });

    it.each([
      [null, "body"],
      [[], "body"],
      ["shop", "body"],
      [{ slug: "shop", taskKeyPrefix: "RF" }, "name"],
      [{ name: "Shop", slug: "-shop", taskKeyPrefix: "RF" }, "slug"],
      [{ name: "Shop", taskKeyPrefix: "RF" }, "slug"],
      [{ name: "Shop", slug: "shop", taskKeyPrefix: "1RF" }, "taskKeyPrefix"],
      [{ name: "Shop", slug: "shop" }, "taskKeyPrefix"],
      [{ name: "Shop", slug: "shop", taskKeyPrefix: "RF", discordChannelId: "abc" }, "discordChannelId"],
      [{ name: "Shop", slug: "shop", taskKeyPrefix: "RF", discordChannelId: 1 }, "discordChannelId"],
    ])("rejects %j as an invalid %s", async (input, field) => {
      expect(await createProject(deps, input)).toEqual({ status: "invalid", field });
      expect(store.projects).toEqual([]);
    });

    it("reports a taken slug or prefix", async () => {
      await seedProject("shop", "RF");
      expect(await createProject(deps, { name: "X", slug: "SHOP", taskKeyPrefix: "XX" })).toEqual({
        status: "slug_taken",
      });
      expect(await createProject(deps, { name: "X", slug: "other", taskKeyPrefix: "rf" })).toEqual({
        status: "prefix_taken",
      });
      expect(store.projects).toHaveLength(1);
    });
  });

  describe("getProject", () => {
    it("returns the project with its repositories and members", async () => {
      const shop = await seedProject("shop", "RF");
      store.members.push({ id: 7, githubLogin: "mona" });
      await store.addProjectMember(shop.id, 7);
      await store.addRepository(shop.id, "acme/shop");

      expect(await getProject(deps, "Shop")).toEqual({
        status: "found",
        project: {
          ...shop,
          repositories: [{ fullName: "acme/shop", githubInstallationId: null }],
          members: [{ githubLogin: "mona", createdAt }],
        },
      });
    });

    it.each([["ghost"], ["not a slug"]])("reports %j as not found", async (slug) => {
      expect(await getProject(deps, slug)).toEqual({ status: "not_found" });
    });
  });

  describe("updateProject", () => {
    let shop: ProjectRecord;

    beforeEach(async () => {
      shop = await seedProject("shop", "RF");
    });

    it("applies a partial update, normalizing every field", async () => {
      const result = await updateProject(deps, "shop", {
        name: " Shop 2 ",
        slug: "Shop-2",
        taskKeyPrefix: "sh",
        discordChannelId: CHANNEL,
      });

      expect(result).toEqual({
        status: "updated",
        project: { ...shop, name: "Shop 2", slug: "shop-2", taskKeyPrefix: "SH", discordChannelId: CHANNEL },
      });
      expect(store.locks).toEqual(["shop"]);
      expect(store.transactions).toBe(1);
    });

    it("clears the Discord channel with null and leaves other fields alone", async () => {
      await store.updateProject(shop.id, { discordChannelId: CHANNEL });
      const result = await updateProject(deps, "shop", { discordChannelId: null });
      expect(result).toEqual({ status: "updated", project: { ...shop, discordChannelId: null } });
    });

    it("rejects an update without known fields", async () => {
      expect(await updateProject(deps, "shop", { other: 1 })).toEqual({ status: "empty_update" });
    });

    it.each([
      [null, "body"],
      [{ name: "  " }, "name"],
      [{ slug: "a b" }, "slug"],
      [{ slug: null }, "slug"],
      [{ taskKeyPrefix: "R-F" }, "taskKeyPrefix"],
      [{ discordChannelId: "1" }, "discordChannelId"],
    ])("rejects %j as an invalid %s", async (input, field) => {
      expect(await updateProject(deps, "shop", input)).toEqual({ status: "invalid", field });
      expect(store.projects[0]).toMatchObject({ slug: "shop", name: "SHOP", taskKeyPrefix: "RF" });
    });

    it("reports an unknown project", async () => {
      expect(await updateProject(deps, "ghost", { name: "X" })).toEqual({ status: "not_found" });
    });

    it("reports a slug or prefix taken by another project", async () => {
      await seedProject("blog", "BL");
      expect(await updateProject(deps, "shop", { slug: "blog" })).toEqual({ status: "slug_taken" });
      expect(await updateProject(deps, "shop", { taskKeyPrefix: "bl" })).toEqual({
        status: "prefix_taken",
      });
    });

    it("locks the prefix once the project has tasks", async () => {
      store.tasks.push({ id: 1, projectId: shop.id, status: "done", assigneeId: null });

      expect(await updateProject(deps, "shop", { name: "X", taskKeyPrefix: "SH" })).toEqual({
        status: "prefix_locked",
      });
      expect(store.projects[0]).toMatchObject({ name: "SHOP", taskKeyPrefix: "RF" });
    });

    it("accepts the unchanged prefix (in any case) on a project with tasks", async () => {
      store.tasks.push({ id: 1, projectId: shop.id, status: "todo", assigneeId: null });
      expect(await updateProject(deps, "shop", { name: "X", taskKeyPrefix: "rf" })).toMatchObject({
        status: "updated",
        project: { name: "X", taskKeyPrefix: "RF" },
      });
    });
  });

  describe("deleteProject", () => {
    it("deletes the project and everything attached to it", async () => {
      const shop = await seedProject("shop", "RF");
      await store.addRepository(shop.id, "acme/shop");

      expect(await deleteProject(deps, "SHOP")).toEqual({ status: "deleted" });
      expect(store.projects).toEqual([]);
      expect(store.repositories).toEqual([]);
    });

    it("reports an unknown project", async () => {
      expect(await deleteProject(deps, "ghost")).toEqual({ status: "not_found" });
    });
  });

  describe("project repositories", () => {
    let shop: ProjectRecord;

    beforeEach(async () => {
      shop = await seedProject("shop", "RF");
    });

    it("links a repository stored lowercased", async () => {
      expect(await addProjectRepository(deps, "shop", "Acme/Shop")).toEqual({
        status: "created",
        repository: { fullName: "acme/shop", githubInstallationId: null },
      });
      expect(store.repositories).toEqual([expect.objectContaining({ projectId: shop.id, fullName: "acme/shop" })]);
    });

    it.each([["acme"], ["acme/.."], [42], [undefined]])("rejects the invalid name %j", async (fullName) => {
      expect(await addProjectRepository(deps, "shop", fullName)).toEqual({
        status: "invalid_repository",
      });
    });

    it("rejects a repository already linked to any project", async () => {
      const blog = await seedProject("blog", "BL");
      await store.addRepository(blog.id, "acme/shop");

      expect(await addProjectRepository(deps, "shop", "ACME/shop")).toEqual({
        status: "repository_taken",
      });
      expect(await addProjectRepository(deps, "blog", "acme/shop")).toEqual({
        status: "repository_taken",
      });
    });

    it("reports an unknown project when linking", async () => {
      expect(await addProjectRepository(deps, "ghost", "acme/shop")).toEqual({
        status: "project_not_found",
      });
    });

    it("unlinks a repository of the project, case-insensitively", async () => {
      await store.addRepository(shop.id, "acme/shop");
      expect(await removeProjectRepository(deps, "shop", "Acme/Shop")).toEqual({ status: "removed" });
      expect(store.repositories).toEqual([]);
    });

    it("does not unlink a repository of another project", async () => {
      const blog = await seedProject("blog", "BL");
      await store.addRepository(blog.id, "acme/blog");

      expect(await removeProjectRepository(deps, "shop", "acme/blog")).toEqual({
        status: "repository_not_found",
      });
      expect(await removeProjectRepository(deps, "shop", "not valid")).toEqual({
        status: "repository_not_found",
      });
      expect(await removeProjectRepository(deps, "ghost", "acme/blog")).toEqual({
        status: "project_not_found",
      });
      expect(store.repositories).toHaveLength(1);
    });
  });

  describe("project members", () => {
    let shop: ProjectRecord;

    beforeEach(async () => {
      shop = await seedProject("shop", "RF");
      store.members.push({ id: 7, githubLogin: "mona" }, { id: 8, githubLogin: "octocat" });
    });

    it("adds an app member to the project", async () => {
      expect(await addProjectMember(deps, "shop", "Mona")).toEqual({
        status: "created",
        member: { githubLogin: "mona", createdAt },
      });
      expect(store.projectMembers).toEqual([{ projectId: shop.id, memberId: 7, createdAt }]);
    });

    it.each([["-mona"], [42], [undefined]])("rejects the invalid login %j", async (githubLogin) => {
      expect(await addProjectMember(deps, "shop", githubLogin)).toEqual({ status: "invalid_login" });
    });

    it("rejects a configured admin, who already has access to every project", async () => {
      expect(await addProjectMember(deps, "shop", "OctoCat")).toEqual({ status: "already_admin" });
      expect(store.projectMembers).toEqual([]);
    });

    it("rejects a login that is not an app member", async () => {
      expect(await addProjectMember(deps, "shop", "bob")).toEqual({ status: "member_not_found" });
    });

    it("rejects a member already in the project", async () => {
      await store.addProjectMember(shop.id, 7);
      expect(await addProjectMember(deps, "shop", "mona")).toEqual({
        status: "already_project_member",
      });
      expect(store.projectMembers).toHaveLength(1);
    });

    it("reports an unknown project when adding", async () => {
      expect(await addProjectMember(deps, "ghost", "mona")).toEqual({ status: "project_not_found" });
    });

    describe("removeProjectMember", () => {
      beforeEach(async () => {
        const blog = await seedProject("blog", "BL");
        await store.addProjectMember(shop.id, 7);
        store.users.push({ id: 100, githubLogin: "Mona" }, { id: 101, githubLogin: "bob" });
        store.tasks.push(
          { id: 1, projectId: shop.id, status: "todo", assigneeId: 100 },
          { id: 2, projectId: shop.id, status: "in_review", assigneeId: 100 },
          { id: 3, projectId: shop.id, status: "done", assigneeId: 100 },
          { id: 4, projectId: shop.id, status: "todo", assigneeId: 101 },
          { id: 5, projectId: blog.id, status: "todo", assigneeId: 100 },
        );
      });

      it("removes the member and unassigns their open tasks in this project only", async () => {
        expect(await removeProjectMember(deps, "shop", "MONA")).toEqual({ status: "removed" });

        expect(store.projectMembers).toEqual([]);
        expect(store.tasks.map((t) => [t.id, t.assigneeId])).toEqual([
          [1, null],
          [2, null],
          [3, 100],
          [4, 101],
          [5, 100],
        ]);
        expect(store.transactions).toBe(1);
      });

      it("moves their in-progress tasks in this project back to todo and keeps other statuses", async () => {
        store.tasks.push(
          { id: 6, projectId: shop.id, status: "in_progress", assigneeId: 100 },
          { id: 7, projectId: shop.id, status: "blocked", assigneeId: 100 },
          { id: 8, projectId: shop.id, status: "in_progress", assigneeId: 101 },
        );

        expect(await removeProjectMember(deps, "shop", "mona")).toEqual({ status: "removed" });

        expect(store.tasks.map((t) => [t.id, t.status, t.assigneeId])).toEqual([
          [1, "todo", null],
          [2, "in_review", null],
          [3, "done", 100],
          [4, "todo", 101],
          [5, "todo", 100],
          [6, "todo", null],
          [7, "blocked", null],
          [8, "in_progress", 101],
        ]);
        expect(store.transactions).toBe(1);
      });

      it("reports a login that is not in the project without touching tasks", async () => {
        expect(await removeProjectMember(deps, "shop", "bob")).toEqual({
          status: "project_member_not_found",
        });
        expect(await removeProjectMember(deps, "shop", "not a login")).toEqual({
          status: "project_member_not_found",
        });
        expect(store.tasks.filter((t) => t.assigneeId === null)).toEqual([]);
      });

      it("reports an unknown project", async () => {
        expect(await removeProjectMember(deps, "ghost", "mona")).toEqual({
          status: "project_not_found",
        });
      });

      it("keeps the tasks of a configured admin whose stale membership is removed", async () => {
        await store.addProjectMember(shop.id, 8);
        store.users.push({ id: 102, githubLogin: "OctoCat" });
        store.tasks.push({ id: 6, projectId: shop.id, status: "todo", assigneeId: 102 });

        expect(await removeProjectMember(deps, "shop", "octocat")).toEqual({ status: "removed" });
        expect(store.tasks.find((t) => t.id === 6)?.assigneeId).toBe(102);
      });
    });
  });
});

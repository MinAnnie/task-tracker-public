import { eq, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import { updateProject } from "../application/projects.ts";
import type { AuthenticatedUser } from "../application/sessions.ts";
import {
  addTaskDependency,
  createTask,
  deleteTask,
  getTask,
  listParticipants,
  listTasks,
  releaseTask,
  removeTaskDependency,
  takeTask,
  updateTask,
} from "../application/tasks.ts";
import { createDb } from "../db/client.ts";
import {
  members,
  projectMembers,
  projects,
  pullRequests,
  repositories,
  taskDependencies,
  taskPullRequests,
  tasks,
  users,
} from "../db/schema.ts";
import { createDrizzleProjectStore } from "./drizzle-project-store.ts";
import { createDrizzleTaskStore } from "./drizzle-task-store.ts";

const { sql, db } = createDb(testDatabaseUrl);
const store = createDrizzleTaskStore(db);
const adminLogins = ["octocat"];
const notifications = new RecordingNotifications();
const deps = { store, adminLogins, notifications };

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const seedUser = async (githubId: number, githubLogin: string, role: "admin" | "member") => {
  const [row] = await db
    .insert(users)
    .values({ githubId, githubLogin, name: `${githubLogin} name`, avatarUrl: null })
    .returning({ id: users.id });
  const user: AuthenticatedUser = { id: row!.id, githubLogin, name: `${githubLogin} name`, avatarUrl: null, role };
  return user;
};

const seedProject = async (slug: string, taskKeyPrefix: string) => {
  const [row] = await db.insert(projects).values({ slug, name: slug, taskKeyPrefix }).returning({ id: projects.id });
  return row!.id;
};

const addToProject = async (projectId: number, githubLogin: string) => {
  const [member] = await db.insert(members).values({ githubLogin }).returning({ id: members.id });
  await db.insert(projectMembers).values({ projectId, memberId: member!.id });
};

const seedTask = async (projectId: number, key: string, fields: Partial<typeof tasks.$inferInsert> = {}) => {
  const [row] = await db
    .insert(tasks)
    .values({ projectId, key, title: `Task ${key}`, ...fields })
    .returning({ id: tasks.id });
  return row!.id;
};

const row = async (key: string) => {
  const [task] = await db
    .select({ status: tasks.status, assigneeId: tasks.assigneeId, priority: tasks.priority })
    .from(tasks)
    .where(eq(tasks.key, key));
  return task;
};

const nextTaskNumber = async (projectId: number) =>
  (await db.select({ next: projects.nextTaskNumber }).from(projects).where(eq(projects.id, projectId)))[0]?.next;

describe("createDrizzleTaskStore (Postgres)", () => {
  let shop: number;
  let blog: number;
  let admin: AuthenticatedUser;
  let mona: AuthenticatedUser;
  let bob: AuthenticatedUser;
  let eve: AuthenticatedUser;

  beforeEach(async () => {
    await db.execute(
      rawSql`truncate table task_dependencies, project_members, members, sessions, task_pull_requests, pull_requests, tasks, repositories, users, projects restart identity cascade`,
    );
    shop = await seedProject("shop", "RF");
    blog = await seedProject("blog", "BL");
    admin = await seedUser(1, "OctoCat", "admin");
    mona = await seedUser(2, "Mona", "member");
    bob = await seedUser(3, "bob", "member");
    eve = await seedUser(4, "eve", "member");
    await addToProject(shop, "mona");
    await addToProject(shop, "bob");
    await addToProject(blog, "eve");
  });

  describe("schema", () => {
    it("defaults the priority to medium", async () => {
      await seedTask(shop, "RF-1");
      expect((await row("RF-1"))?.priority).toBe("medium");
    });

    it("rejects a self-dependency and cascades dependencies with their tasks", async () => {
      const one = await seedTask(shop, "RF-1");
      const two = await seedTask(shop, "RF-2");
      await expect(db.insert(taskDependencies).values({ taskId: one, dependsOnTaskId: one })).rejects.toThrow();

      await db.insert(taskDependencies).values({ taskId: two, dependsOnTaskId: one });
      await db.delete(tasks).where(eq(tasks.id, one));
      expect(await db.select().from(taskDependencies)).toEqual([]);
    });
  });

  describe("createTask", () => {
    it("creates tasks with sequential keys and advances the counter", async () => {
      const first = await createTask(deps, mona, "shop", { title: "One", priority: "high", stage: "Backend" });
      const second = await createTask(deps, mona, "shop", { title: "Two", assigneeLogin: "BOB" });

      expect(first).toEqual({
        status: "created",
        task: {
          key: "RF-1",
          title: "One",
          description: null,
          status: "todo",
          priority: "high",
          stage: "Backend",
          assignee: null,
          canTake: true,
          pendingDependencies: [],
          dependsOn: [],
          blocks: [],
          pullRequests: [],
        },
      });
      expect(second).toMatchObject({
        task: { key: "RF-2", status: "in_progress", assignee: { login: "bob", name: "bob name", avatarUrl: null } },
      });
      expect(await nextTaskNumber(shop)).toBe(3);
    });

    it("skips past imported keys instead of hitting the unique constraint", async () => {
      await seedTask(shop, "RF-1");
      await seedTask(shop, "rf-41");
      await seedTask(shop, "LEGACY-99");
      await seedTask(blog, "RF-500");

      expect(await createTask(deps, admin, "shop", { title: "Next" })).toMatchObject({ task: { key: "RF-42" } });
      expect(await nextTaskNumber(shop)).toBe(43);
    });

    it("numbers concurrent creations without duplicates", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => createTask(deps, mona, "shop", { title: `Task ${i}` })),
      );

      const keys = results.map((r) => (r.status === "created" ? r.task.key : r.status)).sort();
      expect(keys).toEqual(["RF-1", "RF-2", "RF-3", "RF-4", "RF-5", "RF-6"]);
      expect(await nextTaskNumber(shop)).toBe(7);
    });

    it("serializes with a concurrent prefix change, which must then see the task", async () => {
      const projectsDeps = { store: createDrizzleProjectStore(db), adminLogins };
      const [created, renamed] = await Promise.all([
        createTask(deps, mona, "shop", { title: "One" }),
        updateProject(projectsDeps, "shop", { taskKeyPrefix: "SH" }),
      ]);

      const keys = (await db.select({ key: tasks.key }).from(tasks)).map((t) => t.key);
      if (renamed.status === "updated") {
        expect(keys).toEqual(["SH-1"]);
      } else {
        expect(renamed).toEqual({ status: "prefix_locked" });
        expect(keys).toEqual(["RF-1"]);
      }
      expect(created.status).toBe("created");
    });

    it("rejects an assignee outside the project or who never signed in", async () => {
      await addToProject(shop, "carol");
      expect(await createTask(deps, mona, "shop", { title: "X", assigneeLogin: "eve" })).toEqual({
        status: "invalid_assignee",
      });
      expect(await createTask(deps, mona, "shop", { title: "X", assigneeLogin: "carol" })).toEqual({
        status: "invalid_assignee",
      });
      expect(await db.select().from(tasks)).toEqual([]);
    });

    it("forbids members outside the project", async () => {
      expect(await createTask(deps, eve, "shop", { title: "X" })).toEqual({ status: "forbidden" });
    });
  });

  describe("board and detail", () => {
    it("lists the project's tasks with assignee, pull requests and dependencies", async () => {
      const api = await seedTask(shop, "RF-1", { status: "done" });
      const checkout = await seedTask(shop, "RF-2", {
        priority: "urgent",
        status: "in_progress",
        assigneeId: mona.id,
        description: "Use Wompi",
      });
      const ui = await seedTask(shop, "RF-10", { priority: "urgent" });
      await seedTask(blog, "BL-1");
      await db.insert(taskDependencies).values([
        { taskId: checkout, dependsOnTaskId: api },
        { taskId: ui, dependsOnTaskId: checkout },
      ]);
      const [repository] = await db
        .insert(repositories)
        .values({ projectId: shop, githubFullName: "acme/shop" })
        .returning({ id: repositories.id });
      const [pr] = await db
        .insert(pullRequests)
        .values({
          repositoryId: repository!.id,
          number: 7,
          title: "RF-2 checkout",
          branch: "feat/RF-2",
          url: "https://github.com/acme/shop/pull/7",
          authorGithubLogin: "mona",
          openedAt: new Date("2026-01-01T10:00:00Z"),
        })
        .returning({ id: pullRequests.id });
      await db.insert(taskPullRequests).values({ taskId: checkout, pullRequestId: pr!.id });

      const board = await listTasks(deps, bob, "shop");

      expect(board).toEqual({
        status: "ok",
        tasks: [
          {
            key: "RF-2",
            title: "Task RF-2",
            status: "in_progress",
            priority: "urgent",
            stage: null,
            assignee: { login: "Mona", name: "Mona name", avatarUrl: null },
            pullRequests: [{ number: 7, state: "open", url: "https://github.com/acme/shop/pull/7" }],
            dependsOn: ["RF-1"],
            pendingDependencies: [],
            canTake: false,
          },
          expect.objectContaining({
            key: "RF-10",
            dependsOn: ["RF-2"],
            pendingDependencies: ["RF-2"],
            canTake: false,
          }),
          expect.objectContaining({ key: "RF-1", status: "done", canTake: false }),
        ],
      });

      expect(await getTask(deps, bob, "shop", "rf-2")).toEqual({
        status: "ok",
        task: {
          key: "RF-2",
          title: "Task RF-2",
          description: "Use Wompi",
          status: "in_progress",
          priority: "urgent",
          stage: null,
          assignee: { login: "Mona", name: "Mona name", avatarUrl: null },
          canTake: false,
          pendingDependencies: [],
          dependsOn: [{ key: "RF-1", title: "Task RF-1", status: "done" }],
          blocks: [{ key: "RF-10", title: "Task RF-10", status: "todo" }],
          pullRequests: [
            {
              number: 7,
              title: "RF-2 checkout",
              branch: "feat/RF-2",
              url: "https://github.com/acme/shop/pull/7",
              state: "open",
              author: "mona",
            },
          ],
        },
      });
      expect(await getTask(deps, bob, "shop", "BL-1")).toEqual({ status: "task_not_found" });
    });

    it("prefers the exact key when keys differ only by case", async () => {
      await seedTask(shop, "rf-1", { title: "lower" });
      await seedTask(shop, "RF-1", { title: "upper" });
      expect(await getTask(deps, admin, "shop", "RF-1")).toMatchObject({ task: { title: "upper" } });
      expect(await getTask(deps, admin, "shop", "rf-1")).toMatchObject({ task: { title: "lower" } });
    });
  });

  describe("take and release", () => {
    it("takes and releases a task", async () => {
      await seedTask(shop, "RF-1");

      expect(await takeTask(deps, mona, "shop", "RF-1")).toMatchObject({ status: "ok" });
      expect(await row("RF-1")).toMatchObject({ assigneeId: mona.id, status: "in_progress" });
      expect(await takeTask(deps, bob, "shop", "RF-1")).toEqual({ status: "task_taken" });
      expect(await releaseTask(deps, bob, "shop", "RF-1")).toEqual({ status: "forbidden" });

      expect(await releaseTask(deps, mona, "shop", "RF-1")).toMatchObject({ status: "ok" });
      expect(await row("RF-1")).toMatchObject({ assigneeId: null, status: "todo" });
    });

    it("refuses to take a task with pending dependencies", async () => {
      const dependency = await seedTask(shop, "RF-1", { status: "in_review" });
      const task = await seedTask(shop, "RF-2");
      await db.insert(taskDependencies).values({ taskId: task, dependsOnTaskId: dependency });

      expect(await takeTask(deps, mona, "shop", "RF-2")).toEqual({
        status: "dependencies_pending",
        pendingDependencies: ["RF-1"],
      });
      expect(await store.takeTask(task, mona.id)).toBe(false);
      expect(await row("RF-2")).toMatchObject({ assigneeId: null, status: "todo" });
    });

    it("lets exactly one of two concurrent takes win", async () => {
      await seedTask(shop, "RF-1");

      const results = await Promise.all([
        takeTask(deps, mona, "shop", "RF-1"),
        takeTask(deps, bob, "shop", "RF-1"),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual(["ok", "task_taken"]);
      const winner = results[0]?.status === "ok" ? mona : bob;
      expect(await row("RF-1")).toMatchObject({ assigneeId: winner.id, status: "in_progress" });
    });

    it("lets exactly one of two concurrent conditional writes win, without a prior lock", async () => {
      const task = await seedTask(shop, "RF-1");

      const results = await Promise.all([
        store.transaction((tx) => tx.takeTask(task, mona.id)),
        store.transaction((tx) => tx.takeTask(task, bob.id)),
      ]);

      expect(results.sort()).toEqual([false, true]);
    });
  });

  describe("updateTask", () => {
    it("applies field changes, status and reassignment", async () => {
      await seedTask(shop, "RF-1", { assigneeId: mona.id, status: "in_progress" });

      expect(
        await updateTask(deps, mona, "shop", "RF-1", { title: "Renamed", priority: "low", status: "in_review" }),
      ).toMatchObject({ status: "ok", task: { title: "Renamed", priority: "low", status: "in_review" } });
      expect(await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "octocat" })).toMatchObject({
        task: { assignee: { login: "OctoCat" } },
      });
      expect(await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: null, stage: "QA" })).toMatchObject({
        task: { assignee: null, stage: "QA" },
      });
    });

    it("refuses to start a task with pending dependencies", async () => {
      const dependency = await seedTask(shop, "RF-1");
      const task = await seedTask(shop, "RF-2");
      await db.insert(taskDependencies).values({ taskId: task, dependsOnTaskId: dependency });

      expect(await updateTask(deps, admin, "shop", "RF-2", { status: "done" })).toEqual({
        status: "dependencies_pending",
        pendingDependencies: ["RF-1"],
      });
      expect((await row("RF-2"))?.status).toBe("todo");
    });
  });

  describe("dependencies", () => {
    it("adds, rejects duplicates and cycles, and removes dependencies", async () => {
      await seedTask(shop, "RF-1");
      await seedTask(shop, "RF-2");
      await seedTask(shop, "RF-3");
      await seedTask(blog, "BL-1");

      expect(await addTaskDependency(deps, bob, "shop", "RF-2", "RF-1")).toEqual({
        status: "created",
        dependency: { key: "RF-1", title: "Task RF-1", status: "todo" },
      });
      expect(await addTaskDependency(deps, bob, "shop", "RF-3", "RF-2")).toMatchObject({ status: "created" });
      expect(await addTaskDependency(deps, bob, "shop", "RF-2", "RF-1")).toEqual({ status: "dependency_exists" });
      expect(await addTaskDependency(deps, bob, "shop", "RF-1", "RF-3")).toEqual({ status: "dependency_cycle" });
      expect(await addTaskDependency(deps, bob, "shop", "RF-1", "BL-1")).toEqual({ status: "task_not_found" });
      expect(await addTaskDependency(deps, bob, "shop", "RF-1", "rf-1")).toEqual({ status: "self_dependency" });

      expect(await removeTaskDependency(deps, bob, "shop", "RF-3", "RF-2")).toEqual({ status: "removed" });
      expect(await removeTaskDependency(deps, bob, "shop", "RF-3", "RF-2")).toEqual({
        status: "dependency_not_found",
      });
      expect(await db.select().from(taskDependencies)).toHaveLength(1);
    });

    it("never lets two concurrent additions close a cycle", async () => {
      await seedTask(shop, "RF-1");
      await seedTask(shop, "RF-2");

      const results = await Promise.all([
        addTaskDependency(deps, bob, "shop", "RF-1", "RF-2"),
        addTaskDependency(deps, mona, "shop", "RF-2", "RF-1"),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual(["created", "dependency_cycle"]);
      expect(await db.select().from(taskDependencies)).toHaveLength(1);
    });
  });

  describe("deleteTask", () => {
    it("deletes the task, cascading its dependency edges and pull request links but keeping the pull request", async () => {
      const api = await seedTask(shop, "RF-1");
      const checkout = await seedTask(shop, "RF-2");
      const ui = await seedTask(shop, "RF-3");
      await db.insert(taskDependencies).values([
        { taskId: checkout, dependsOnTaskId: api },
        { taskId: ui, dependsOnTaskId: checkout },
        { taskId: ui, dependsOnTaskId: api },
      ]);
      const [repository] = await db
        .insert(repositories)
        .values({ projectId: shop, githubFullName: "acme/shop" })
        .returning({ id: repositories.id });
      const [pr] = await db
        .insert(pullRequests)
        .values({
          repositoryId: repository!.id,
          number: 7,
          title: "RF-2 checkout",
          branch: "feat/RF-2",
          url: "https://github.com/acme/shop/pull/7",
          authorGithubLogin: "mona",
          openedAt: new Date("2026-01-01T10:00:00Z"),
        })
        .returning({ id: pullRequests.id });
      await db.insert(taskPullRequests).values([
        { taskId: checkout, pullRequestId: pr!.id },
        { taskId: ui, pullRequestId: pr!.id },
      ]);

      expect(await deleteTask(deps, admin, "shop", "rf-2")).toEqual({ status: "deleted" });

      expect((await db.select({ key: tasks.key }).from(tasks)).map((t) => t.key).sort()).toEqual(["RF-1", "RF-3"]);
      expect(await db.select().from(taskDependencies)).toEqual([{ taskId: ui, dependsOnTaskId: api }]);
      expect(await db.select().from(taskPullRequests)).toEqual([{ taskId: ui, pullRequestId: pr!.id }]);
      expect(await db.select({ id: pullRequests.id }).from(pullRequests)).toEqual([{ id: pr!.id }]);
      expect(await getTask(deps, admin, "shop", "RF-2")).toEqual({ status: "task_not_found" });
    });

    it("forbids members and reports an unknown task", async () => {
      await seedTask(shop, "RF-1");
      expect(await deleteTask(deps, mona, "shop", "RF-1")).toEqual({ status: "forbidden" });
      expect(await deleteTask(deps, eve, "shop", "RF-1")).toEqual({ status: "forbidden" });
      expect(await deleteTask(deps, admin, "shop", "RF-9")).toEqual({ status: "task_not_found" });
      expect(await db.select().from(tasks)).toHaveLength(1);
    });

    it("never reuses the key of a deleted latest task", async () => {
      for (const title of ["One", "Two", "Three"]) await createTask(deps, admin, "shop", { title });

      expect(await deleteTask(deps, admin, "shop", "RF-3")).toEqual({ status: "deleted" });

      expect(await createTask(deps, admin, "shop", { title: "Four" })).toMatchObject({
        status: "created",
        task: { key: "RF-4" },
      });
      expect(await nextTaskNumber(shop)).toBe(5);
    });
  });

  describe("listParticipants", () => {
    it("lists configured admins and project members who signed in, newest user per login", async () => {
      await addToProject(shop, "neverloggedin");
      // A renamed account: two users once held the login; the newest one wins.
      await db.insert(users).values({ githubId: 9, githubLogin: "BOB", name: "Bob renamed", avatarUrl: null });

      const result = await listParticipants({ ...deps, adminLogins: ["octocat", "ghostadmin"] }, mona, "shop");

      expect(result).toEqual({
        status: "ok",
        participants: [
          { login: "BOB", name: "Bob renamed", avatarUrl: null },
          { login: "Mona", name: "Mona name", avatarUrl: null },
          { login: "OctoCat", name: "OctoCat name", avatarUrl: null },
        ],
      });
    });

    it("forbids members outside the project", async () => {
      expect(await listParticipants(deps, eve, "shop")).toEqual({ status: "forbidden" });
    });
  });

  describe("notifications", () => {
    const CHANNEL = "998877";
    const unblocked = (key: string, assigneeLogin: string | null = null) => ({
      type: "task_unblocked",
      channelId: CHANNEL,
      projectSlug: "shop",
      task: { key, title: `Task ${key}` },
      assigneeLogin,
    });

    beforeEach(async () => {
      notifications.events = [];
      await db.update(projects).set({ discordChannelId: CHANNEL }).where(eq(projects.id, shop));
    });

    const dependOn = async (taskId: number, dependsOnTaskId: number) =>
      db.insert(taskDependencies).values({ taskId, dependsOnTaskId });

    it("announces creation and taking with the project's channel", async () => {
      await createTask(deps, mona, "shop", { title: "Prod is down", priority: "urgent" });
      await takeTask(deps, bob, "shop", "RF-1");

      expect(notifications.events).toEqual([
        expect.objectContaining({
          type: "task_created",
          channelId: CHANNEL,
          task: { key: "RF-1", title: "Prod is down" },
          priority: "urgent",
        }),
        expect.objectContaining({ type: "task_taken", channelId: CHANNEL, assigneeLogin: "bob", actorLogin: "bob" }),
      ]);
    });

    it("loads the assignee's linked Discord id for the event", async () => {
      const BOB_DISCORD = "333333333333333333";
      await db.update(users).set({ discordUserId: BOB_DISCORD, discordUsername: "bob#1" }).where(eq(users.id, bob.id));
      await seedTask(shop, "RF-1");
      await seedTask(shop, "RF-2");

      await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "bob" });
      await takeTask(deps, bob, "shop", "RF-2");
      await createTask(deps, admin, "shop", { title: "Docs", assigneeLogin: "mona" });

      expect(notifications.events).toEqual([
        expect.objectContaining({ type: "task_taken", assigneeLogin: "bob", assigneeDiscordUserId: BOB_DISCORD, ping: true }),
        expect.objectContaining({ type: "task_taken", assigneeLogin: "bob", assigneeDiscordUserId: BOB_DISCORD, ping: false }),
        expect.objectContaining({ type: "task_created", assigneeLogin: "Mona", assigneeDiscordUserId: null, ping: false }),
      ]);
    });

    it("announces dependents unblocked by a status change to done", async () => {
      const api = await seedTask(shop, "RF-1", { assigneeId: mona.id, status: "in_review" });
      const other = await seedTask(shop, "RF-2", { status: "done" });
      const ui = await seedTask(shop, "RF-3", { assigneeId: bob.id });
      const blocked = await seedTask(shop, "RF-4");
      const pending = await seedTask(shop, "RF-5");
      const finished = await seedTask(shop, "RF-6", { status: "done" });
      await dependOn(ui, api);
      await dependOn(ui, other);
      await dependOn(blocked, api);
      await dependOn(blocked, pending);
      await dependOn(finished, api);

      expect(await updateTask(deps, mona, "shop", "RF-1", { status: "done" })).toMatchObject({ status: "ok" });

      expect(notifications.events).toEqual([unblocked("RF-3", "bob")]);
    });

    it("announces a task whose last pending dependency is removed", async () => {
      const api = await seedTask(shop, "RF-1");
      const done = await seedTask(shop, "RF-2", { status: "done" });
      const ui = await seedTask(shop, "RF-3");
      await dependOn(ui, api);
      await dependOn(ui, done);

      expect(await removeTaskDependency(deps, bob, "shop", "RF-3", "RF-2")).toEqual({ status: "removed" });
      expect(notifications.events).toEqual([]);
      expect(await removeTaskDependency(deps, bob, "shop", "RF-3", "RF-1")).toEqual({ status: "removed" });
      expect(notifications.events).toEqual([unblocked("RF-3")]);
    });

    it("stays silent for projects without a channel", async () => {
      await db.update(projects).set({ discordChannelId: null }).where(eq(projects.id, shop));
      const api = await seedTask(shop, "RF-1", { assigneeId: mona.id, status: "in_review" });
      await dependOn(await seedTask(shop, "RF-2"), api);

      await updateTask(deps, mona, "shop", "RF-1", { status: "done" });
      await createTask(deps, mona, "shop", { title: "Urgent", priority: "urgent" });

      expect(notifications.events).toEqual([]);
    });

    it("announces a task once when its last two dependencies get done concurrently", async () => {
      for (let round = 0; round < 5; round++) {
        notifications.events = [];
        await db.execute(rawSql`truncate table task_dependencies, task_pull_requests, tasks restart identity cascade`);
        const first = await seedTask(shop, "RF-1", { assigneeId: mona.id, status: "in_review" });
        const second = await seedTask(shop, "RF-2", { assigneeId: bob.id, status: "in_review" });
        const ui = await seedTask(shop, "RF-3");
        await dependOn(ui, first);
        await dependOn(ui, second);

        await Promise.all([
          updateTask(deps, mona, "shop", "RF-1", { status: "done" }),
          updateTask(deps, bob, "shop", "RF-2", { status: "done" }),
        ]);

        expect(notifications.events).toEqual([unblocked("RF-3")]);
      }
    });

    it("announces a task once when its last dependency gets done while being removed", async () => {
      for (let round = 0; round < 5; round++) {
        notifications.events = [];
        await db.execute(rawSql`truncate table task_dependencies, task_pull_requests, tasks restart identity cascade`);
        const api = await seedTask(shop, "RF-1", { assigneeId: mona.id, status: "in_review" });
        const ui = await seedTask(shop, "RF-2");
        await dependOn(ui, api);

        await Promise.all([
          updateTask(deps, mona, "shop", "RF-1", { status: "done" }),
          removeTaskDependency(deps, bob, "shop", "RF-2", "RF-1"),
        ]);

        expect(notifications.events).toEqual([unblocked("RF-2")]);
      }
    });
    it("announces the dependents a deleted task leaves unblocked, unless it was done", async () => {
      const api = await seedTask(shop, "RF-1");
      const done = await seedTask(shop, "RF-2", { status: "done" });
      const ui = await seedTask(shop, "RF-3", { assigneeId: bob.id, status: "in_progress" });
      const blocked = await seedTask(shop, "RF-4");
      const pending = await seedTask(shop, "RF-5");
      const finished = await seedTask(shop, "RF-6", { status: "done" });
      const afterDone = await seedTask(shop, "RF-7");
      await dependOn(ui, api);
      await dependOn(ui, done);
      await dependOn(blocked, api);
      await dependOn(blocked, pending);
      await dependOn(finished, api);
      await dependOn(afterDone, done);

      expect(await deleteTask(deps, admin, "shop", "RF-1")).toEqual({ status: "deleted" });
      expect(notifications.events).toEqual([unblocked("RF-3", "bob")]);

      notifications.events = [];
      expect(await deleteTask(deps, admin, "shop", "RF-2")).toEqual({ status: "deleted" });
      expect(notifications.events).toEqual([]);
    });

    it("announces a task once when its last dependencies get deleted and done concurrently", async () => {
      for (let round = 0; round < 5; round++) {
        notifications.events = [];
        await db.execute(rawSql`truncate table task_dependencies, task_pull_requests, tasks restart identity cascade`);
        const api = await seedTask(shop, "RF-1", { assigneeId: mona.id, status: "in_review" });
        const doomed = await seedTask(shop, "RF-2");
        const ui = await seedTask(shop, "RF-3");
        await dependOn(ui, api);
        await dependOn(ui, doomed);

        await Promise.all([
          updateTask(deps, mona, "shop", "RF-1", { status: "done" }),
          deleteTask(deps, admin, "shop", "RF-2"),
        ]);

        expect(notifications.events).toEqual([unblocked("RF-3")]);
      }
    });
  });
});

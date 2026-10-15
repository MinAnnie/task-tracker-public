import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskStore, type StoredTask } from "../../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import type { AuthenticatedUser } from "./sessions.ts";
import type { TaskPullRequestRecord } from "./task-store.ts";
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
  type ApiTokenViewer,
  type TasksDeps,
} from "./tasks.ts";

const PROJECT_ID = 3;
const OTHER_PROJECT_ID = 4;

const user = (id: number, githubLogin: string, role: "admin" | "member"): AuthenticatedUser => ({
  id,
  githubLogin,
  name: `${githubLogin} name`,
  avatarUrl: `https://avatars.example.com/${githubLogin}`,
  role,
});

const admin = user(1, "OctoCat", "admin");
const mona = user(2, "Mona", "member");
const bob = user(3, "bob", "member");
/** A member of the app who does not belong to the `shop` project. */
const outsider = user(4, "eve", "member");

const CREATED_AT = new Date("2026-02-01T10:00:00.000Z");
const UPDATED_AT = new Date("2026-02-03T12:30:00.000Z");

const assigneeOf = (u: AuthenticatedUser) => ({ login: u.githubLogin, name: u.name, avatarUrl: u.avatarUrl });

describe("tasks", () => {
  let store: InMemoryTaskStore;
  let deps: TasksDeps;
  let nextTaskId: number;

  const seedTask = (key: string, fields: Partial<StoredTask> = {}): StoredTask => {
    const task: StoredTask = {
      id: nextTaskId++,
      projectId: PROJECT_ID,
      key,
      title: `Task ${key}`,
      description: null,
      status: "todo",
      priority: "medium",
      stage: null,
      assigneeId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...fields,
    };
    store.tasks.push(task);
    return task;
  };

  const dependOn = (task: StoredTask, dependency: StoredTask) =>
    store.dependencies.push({ taskId: task.id, dependsOnTaskId: dependency.id });

  const linkPullRequest = (task: StoredTask, pr: Partial<TaskPullRequestRecord> & { number: number }) =>
    store.pullRequests.push({
      taskId: task.id,
      title: `PR ${pr.number}`,
      branch: `feat/${task.key}`,
      url: `https://github.com/acme/shop/pull/${pr.number}`,
      state: "open",
      authorGithubLogin: "octocat",
      ...pr,
    });

  beforeEach(() => {
    nextTaskId = 1;
    store = new InMemoryTaskStore();
    store.projects.push(
      { id: PROJECT_ID, slug: "shop", taskKeyPrefix: "RF", nextTaskNumber: 1, discordChannelId: null },
      { id: OTHER_PROJECT_ID, slug: "blog", taskKeyPrefix: "BL", nextTaskNumber: 1, discordChannelId: null },
    );
    store.projectMembers.push(
      { projectId: PROJECT_ID, githubLogin: "mona" },
      { projectId: PROJECT_ID, githubLogin: "bob" },
      { projectId: OTHER_PROJECT_ID, githubLogin: "eve" },
    );
    store.users.push(
      ...[admin, mona, bob, outsider].map(({ id, githubLogin, name, avatarUrl }) => ({
        id,
        githubLogin,
        name,
        avatarUrl,
      })),
    );
    deps = { store, adminLogins: ["octocat"], notifications: new RecordingNotifications() };
  });

  describe("project access", () => {
    const calls = [
      ["listTasks", (u: AuthenticatedUser, slug: string) => listTasks(deps, u, slug)],
      ["listParticipants", (u: AuthenticatedUser, slug: string) => listParticipants(deps, u, slug)],
      ["getTask", (u: AuthenticatedUser, slug: string) => getTask(deps, u, slug, "RF-1")],
      ["createTask", (u: AuthenticatedUser, slug: string) => createTask(deps, u, slug, { title: "X" })],
      ["takeTask", (u: AuthenticatedUser, slug: string) => takeTask(deps, u, slug, "RF-1")],
      ["releaseTask", (u: AuthenticatedUser, slug: string) => releaseTask(deps, u, slug, "RF-1")],
      ["updateTask", (u: AuthenticatedUser, slug: string) => updateTask(deps, u, slug, "RF-1", { title: "X" })],
      [
        "addTaskDependency",
        (u: AuthenticatedUser, slug: string) => addTaskDependency(deps, u, slug, "RF-1", "RF-2"),
      ],
      [
        "removeTaskDependency",
        (u: AuthenticatedUser, slug: string) => removeTaskDependency(deps, u, slug, "RF-1", "RF-2"),
      ],
    ] as const;

    beforeEach(() => {
      seedTask("RF-1");
      seedTask("RF-2");
    });

    it.each(calls)("%s reports an unknown project as project_not_found", async (_, call) => {
      expect(await call(admin, "ghost")).toEqual({ status: "project_not_found" });
      expect(await call(mona, "ghost")).toEqual({ status: "project_not_found" });
      expect(await call(admin, "Not a slug!")).toEqual({ status: "project_not_found" });
    });

    it.each(calls)("%s forbids members outside the project", async (_, call) => {
      expect(await call(outsider, "shop")).toEqual({ status: "forbidden" });
    });

    it.each(calls)("%s lets admins and project members in", async (_, call) => {
      expect(await call(admin, "SHOP")).not.toMatchObject({ status: expect.stringMatching(/forbidden|project_not_found/) });
      expect(await call(mona, "shop")).not.toMatchObject({ status: expect.stringMatching(/forbidden|project_not_found/) });
    });
  });

  describe("createTask", () => {
    it("creates a todo task with the next key and default priority", async () => {
      store.now = () => UPDATED_AT;
      const result = await createTask(deps, mona, "shop", { title: "  Add checkout  " });

      expect(result).toEqual({
        status: "created",
        task: {
          key: "RF-1",
          title: "Add checkout",
          description: null,
          status: "todo",
          priority: "medium",
          stage: null,
          assignee: null,
          canTake: true,
          pendingDependencies: [],
          dependsOn: [],
          blocks: [],
          pullRequests: [],
          createdAt: UPDATED_AT.toISOString(),
          updatedAt: UPDATED_AT.toISOString(),
        },
      });
      expect(store.projects[0]?.nextTaskNumber).toBe(2);
      expect(store.projectLocks).toEqual(["shop"]);
    });

    it("stores every optional field", async () => {
      const result = await createTask(deps, admin, "shop", {
        title: "Checkout",
        description: "Use *Wompi*",
        priority: "urgent",
        stage: " Backend ",
      });

      expect(result).toMatchObject({
        status: "created",
        task: { description: "Use *Wompi*", priority: "urgent", stage: "Backend" },
      });
    });

    it("numbers keys sequentially", async () => {
      await createTask(deps, mona, "shop", { title: "One" });
      const second = await createTask(deps, mona, "shop", { title: "Two" });
      expect(second).toMatchObject({ task: { key: "RF-2" } });
      expect(store.projects[0]?.nextTaskNumber).toBe(3);
    });

    it("skips past existing keys of the project that are ahead of the counter", async () => {
      seedTask("RF-7");
      seedTask("rf-9");
      seedTask("LEGACY-50");
      store.tasks.push({ ...store.byKey("RF-7"), id: 99, projectId: OTHER_PROJECT_ID, key: "RF-80" });

      const result = await createTask(deps, mona, "shop", { title: "Next" });

      expect(result).toMatchObject({ task: { key: "RF-10" } });
      expect(store.projects[0]?.nextTaskNumber).toBe(11);
    });

    it("assigns a participant and starts the task in progress", async () => {
      const result = await createTask(deps, mona, "shop", { title: "Mine", assigneeLogin: "BOB" });

      expect(result).toMatchObject({
        status: "created",
        task: { status: "in_progress", assignee: assigneeOf(bob), canTake: false },
      });
      expect(store.byKey("RF-1").assigneeId).toBe(bob.id);
    });

    it("accepts a configured admin as assignee", async () => {
      const result = await createTask(deps, mona, "shop", { title: "For admin", assigneeLogin: "octocat" });
      expect(result).toMatchObject({ task: { assignee: assigneeOf(admin) } });
    });

    it.each([
      ["a member outside the project", "eve"],
      ["a project member who never signed in", "carol"],
      ["an unknown login", "ghost"],
      ["an invalid login", "not a login"],
      ["a non-string", 42],
    ])("rejects %s as assignee", async (_, assigneeLogin) => {
      store.projectMembers.push({ projectId: PROJECT_ID, githubLogin: "carol" });
      const result = await createTask(deps, mona, "shop", { title: "X", assigneeLogin });
      expect(result).toEqual({ status: "invalid_assignee" });
      expect(store.tasks).toHaveLength(0);
    });

    it("treats a null assignee as none", async () => {
      expect(await createTask(deps, mona, "shop", { title: "X", assigneeLogin: null })).toMatchObject({
        task: { status: "todo", assignee: null },
      });
    });

    it.each([
      ["a non-object body", null, "body"],
      ["an array body", [], "body"],
      ["a missing title", {}, "title"],
      ["a blank title", { title: "  " }, "title"],
      ["a long title", { title: "x".repeat(201) }, "title"],
      ["a long description", { title: "X", description: "x".repeat(10_001) }, "description"],
      ["an unknown priority", { title: "X", priority: "critical" }, "priority"],
      ["a long stage", { title: "X", stage: "x".repeat(51) }, "stage"],
    ])("rejects %s", async (_, body, field) => {
      expect(await createTask(deps, mona, "shop", body)).toEqual({ status: "invalid", field });
      expect(store.tasks).toHaveLength(0);
      expect(store.projects[0]?.nextTaskNumber).toBe(1);
    });
  });

  describe("listTasks", () => {
    it("returns the board sorted by priority, then key number", async () => {
      const low = seedTask("RF-1", { priority: "low" });
      const urgent10 = seedTask("RF-10", { priority: "urgent" });
      seedTask("RF-2", { priority: "urgent" });
      seedTask("RF-3", { priority: "medium" });
      store.tasks.push({ ...low, id: 98, projectId: OTHER_PROJECT_ID, key: "BL-1" });
      void urgent10;

      const result = await listTasks(deps, mona, "shop");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.tasks.map((t) => t.key)).toEqual(["RF-2", "RF-10", "RF-3", "RF-1"]);
    });

    it("summarizes assignee, pull requests and dependencies of each task", async () => {
      const api = seedTask("RF-1", { status: "done" });
      const db = seedTask("RF-2", {
        status: "in_progress",
        assigneeId: bob.id,
        stage: "Backend",
        updatedAt: UPDATED_AT,
      });
      const ui = seedTask("RF-3");
      dependOn(ui, api);
      dependOn(ui, db);
      linkPullRequest(db, { number: 8, state: "open" });
      linkPullRequest(db, { number: 5, state: "closed" });

      const result = await listTasks(deps, mona, "shop");

      expect(result).toEqual({
        status: "ok",
        tasks: [
          {
            key: "RF-1",
            title: "Task RF-1",
            status: "done",
            priority: "medium",
            stage: null,
            assignee: null,
            pullRequests: [],
            dependsOn: [],
            pendingDependencies: [],
            canTake: false,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: CREATED_AT.toISOString(),
          },
          {
            key: "RF-2",
            title: "Task RF-2",
            status: "in_progress",
            priority: "medium",
            stage: "Backend",
            assignee: assigneeOf(bob),
            pullRequests: [
              { number: 5, state: "closed", url: "https://github.com/acme/shop/pull/5" },
              { number: 8, state: "open", url: "https://github.com/acme/shop/pull/8" },
            ],
            dependsOn: [],
            pendingDependencies: [],
            canTake: false,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: UPDATED_AT.toISOString(),
          },
          {
            key: "RF-3",
            title: "Task RF-3",
            status: "todo",
            priority: "medium",
            stage: null,
            assignee: null,
            pullRequests: [],
            dependsOn: ["RF-1", "RF-2"],
            pendingDependencies: ["RF-2"],
            canTake: false,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: CREATED_AT.toISOString(),
          },
        ],
      });
    });

    it("lets the caller take unassigned, unfinished tasks without pending dependencies", async () => {
      const done = seedTask("RF-1", { status: "done" });
      seedTask("RF-2");
      const blocked = seedTask("RF-3", { status: "blocked" });
      dependOn(blocked, done);

      const result = await listTasks(deps, mona, "shop");

      expect(result.status === "ok" && result.tasks.map((t) => [t.key, t.canTake])).toEqual([
        ["RF-1", false],
        ["RF-2", true],
        ["RF-3", true],
      ]);
    });
  });

  describe("getTask", () => {
    it("returns the task with description, dependencies, dependents and pull requests", async () => {
      const api = seedTask("RF-1", { status: "done" });
      const checkout = seedTask("RF-2", {
        description: "Use Wompi",
        priority: "high",
        assigneeId: mona.id,
        status: "in_progress",
        updatedAt: UPDATED_AT,
      });
      const ui = seedTask("RF-3");
      dependOn(checkout, api);
      dependOn(ui, checkout);
      linkPullRequest(checkout, { number: 7, title: "RF-2 checkout", branch: "feat/RF-2", state: "merged" });

      const result = await getTask(deps, bob, "shop", "rf-2");

      expect(result).toEqual({
        status: "ok",
        task: {
          key: "RF-2",
          title: "Task RF-2",
          description: "Use Wompi",
          status: "in_progress",
          priority: "high",
          stage: null,
          assignee: assigneeOf(mona),
          canTake: false,
          pendingDependencies: [],
          dependsOn: [{ key: "RF-1", title: "Task RF-1", status: "done" }],
          blocks: [{ key: "RF-3", title: "Task RF-3", status: "todo" }],
          pullRequests: [
            {
              number: 7,
              title: "RF-2 checkout",
              branch: "feat/RF-2",
              url: "https://github.com/acme/shop/pull/7",
              state: "merged",
              author: "octocat",
            },
          ],
          createdAt: CREATED_AT.toISOString(),
          updatedAt: UPDATED_AT.toISOString(),
        },
      });
    });

    it("reports a task of another project as not found", async () => {
      store.tasks.push({ ...seedTask("RF-1"), id: 50, projectId: OTHER_PROJECT_ID, key: "BL-1" });
      expect(await getTask(deps, admin, "shop", "BL-1")).toEqual({ status: "task_not_found" });
      expect(await getTask(deps, admin, "shop", "RF-99")).toEqual({ status: "task_not_found" });
    });
  });

  describe("takeTask", () => {
    it("assigns the caller and moves a todo task to in_progress", async () => {
      seedTask("RF-1");

      const result = await takeTask(deps, mona, "shop", "rf-1");

      expect(result).toMatchObject({
        status: "ok",
        task: { key: "RF-1", status: "in_progress", assignee: assigneeOf(mona), canTake: false },
      });
      expect(store.byKey("RF-1")).toMatchObject({ assigneeId: mona.id, status: "in_progress" });
      expect(store.taskLocks).toEqual(["RF-1"]);
    });

    it.each([["blocked"], ["in_review"], ["in_progress"]] as const)("keeps the %s status", async (status) => {
      seedTask("RF-1", { status });
      await takeTask(deps, admin, "shop", "RF-1");
      expect(store.byKey("RF-1")).toMatchObject({ assigneeId: admin.id, status });
    });

    it("refuses a task assigned to someone (or to the caller)", async () => {
      seedTask("RF-1", { assigneeId: bob.id, status: "in_progress" });
      expect(await takeTask(deps, mona, "shop", "RF-1")).toEqual({ status: "task_taken" });
      expect(await takeTask(deps, bob, "shop", "RF-1")).toEqual({ status: "task_taken" });
      expect(store.byKey("RF-1").assigneeId).toBe(bob.id);
    });

    it("refuses a done task", async () => {
      seedTask("RF-1", { status: "done" });
      expect(await takeTask(deps, mona, "shop", "RF-1")).toEqual({ status: "task_done" });
      expect(store.byKey("RF-1").assigneeId).toBeNull();
    });

    it("refuses a task with pending dependencies and lists them", async () => {
      const done = seedTask("RF-1", { status: "done" });
      const review = seedTask("RF-2", { status: "in_review" });
      const todo = seedTask("RF-3");
      const task = seedTask("RF-4");
      dependOn(task, todo);
      dependOn(task, done);
      dependOn(task, review);

      expect(await takeTask(deps, mona, "shop", "RF-4")).toEqual({
        status: "dependencies_pending",
        pendingDependencies: ["RF-2", "RF-3"],
      });
      expect(store.byKey("RF-4").assigneeId).toBeNull();
    });

    it("reports task_taken when a concurrent take wins between the check and the write", async () => {
      seedTask("RF-1");
      const original = store.takeTask.bind(store);
      store.takeTask = async (taskId, userId) => {
        store.byKey("RF-1").assigneeId = bob.id;
        return original(taskId, userId);
      };

      expect(await takeTask(deps, mona, "shop", "RF-1")).toEqual({ status: "task_taken" });
      expect(store.byKey("RF-1").assigneeId).toBe(bob.id);
    });

    it("reports dependencies_pending when a dependency appears between the check and the write", async () => {
      const dependency = seedTask("RF-1");
      const task = seedTask("RF-2");
      const original = store.takeTask.bind(store);
      store.takeTask = async (taskId, userId) => {
        dependOn(task, dependency);
        return original(taskId, userId);
      };

      expect(await takeTask(deps, mona, "shop", "RF-2")).toEqual({
        status: "dependencies_pending",
        pendingDependencies: ["RF-1"],
      });
    });

    it("reports an unknown task", async () => {
      expect(await takeTask(deps, mona, "shop", "RF-1")).toEqual({ status: "task_not_found" });
    });
  });

  describe("releaseTask", () => {
    it("lets the assignee release an in_progress task back to todo", async () => {
      seedTask("RF-1", { assigneeId: mona.id, status: "in_progress" });

      const result = await releaseTask(deps, mona, "shop", "RF-1");

      expect(result).toMatchObject({ status: "ok", task: { status: "todo", assignee: null, canTake: true } });
      expect(store.byKey("RF-1")).toMatchObject({ assigneeId: null, status: "todo" });
      expect(store.taskLocks).toEqual(["RF-1"]);
    });

    it.each([["in_review"], ["blocked"], ["done"]] as const)("keeps the %s status", async (status) => {
      seedTask("RF-1", { assigneeId: mona.id, status });
      await releaseTask(deps, mona, "shop", "RF-1");
      expect(store.byKey("RF-1")).toMatchObject({ assigneeId: null, status });
    });

    it("lets an admin release someone else's task", async () => {
      seedTask("RF-1", { assigneeId: mona.id, status: "in_progress" });
      expect(await releaseTask(deps, admin, "shop", "RF-1")).toMatchObject({ status: "ok" });
      expect(store.byKey("RF-1").assigneeId).toBeNull();
    });

    it("forbids other members", async () => {
      seedTask("RF-1", { assigneeId: mona.id, status: "in_progress" });
      expect(await releaseTask(deps, bob, "shop", "RF-1")).toEqual({ status: "forbidden" });
      expect(store.byKey("RF-1").assigneeId).toBe(mona.id);
    });

    it("reports an unassigned task", async () => {
      seedTask("RF-1");
      expect(await releaseTask(deps, admin, "shop", "RF-1")).toEqual({ status: "task_not_assigned" });
      expect(await releaseTask(deps, bob, "shop", "RF-1")).toEqual({ status: "task_not_assigned" });
    });

    it("reports an unknown task", async () => {
      expect(await releaseTask(deps, admin, "shop", "RF-1")).toEqual({ status: "task_not_found" });
    });
  });

  describe("updateTask", () => {
    it("lets any participant edit title, description, stage and priority", async () => {
      seedTask("RF-1", { description: "old", stage: "QA" });

      const result = await updateTask(deps, bob, "shop", "RF-1", {
        title: " Renamed ",
        description: null,
        stage: " Backend ",
        priority: "low",
      });

      expect(result).toMatchObject({
        status: "ok",
        task: { title: "Renamed", description: null, stage: "Backend", priority: "low" },
      });
      expect(store.taskLocks).toEqual(["RF-1"]);
    });

    it("clears the stage with null", async () => {
      seedTask("RF-1", { stage: "QA" });
      await updateTask(deps, bob, "shop", "RF-1", { stage: null });
      expect(store.byKey("RF-1").stage).toBeNull();
    });

    it.each([
      ["a non-object body", "x", "body"],
      ["a null title", { title: null }, "title"],
      ["a long title", { title: "x".repeat(201) }, "title"],
      ["a long description", { description: "x".repeat(10_001) }, "description"],
      ["a long stage", { stage: "x".repeat(51) }, "stage"],
      ["an unknown priority", { priority: "now" }, "priority"],
      ["an unknown status", { status: "closed" }, "status"],
    ])("rejects %s", async (_, body, field) => {
      seedTask("RF-1");
      expect(await updateTask(deps, admin, "shop", "RF-1", body)).toEqual({ status: "invalid", field });
    });

    it("rejects an empty update", async () => {
      seedTask("RF-1");
      expect(await updateTask(deps, admin, "shop", "RF-1", {})).toEqual({ status: "empty_update" });
    });

    it("reports an unknown task", async () => {
      expect(await updateTask(deps, admin, "shop", "RF-1", { title: "X" })).toEqual({
        status: "task_not_found",
      });
    });

    describe("status", () => {
      it("lets the assignee change it", async () => {
        seedTask("RF-1", { assigneeId: mona.id, status: "in_progress" });
        expect(await updateTask(deps, mona, "shop", "RF-1", { status: "in_review" })).toMatchObject({
          status: "ok",
          task: { status: "in_review" },
        });
      });

      it("lets an admin change it on any task", async () => {
        seedTask("RF-1");
        expect(await updateTask(deps, admin, "shop", "RF-1", { status: "blocked" })).toMatchObject({
          task: { status: "blocked" },
        });
      });

      it("forbids other members, without applying other fields", async () => {
        seedTask("RF-1", { assigneeId: mona.id, status: "in_progress" });
        expect(await updateTask(deps, bob, "shop", "RF-1", { title: "New", status: "done" })).toEqual({
          status: "forbidden",
        });
        expect(store.byKey("RF-1")).toMatchObject({ title: "Task RF-1", status: "in_progress" });
      });

      it.each([["in_progress"], ["in_review"], ["done"]] as const)(
        "refuses %s while dependencies are pending",
        async (status) => {
          const dependency = seedTask("RF-1", { status: "in_review" });
          const task = seedTask("RF-2", { assigneeId: mona.id, status: "blocked" });
          dependOn(task, dependency);

          expect(await updateTask(deps, mona, "shop", "RF-2", { status })).toEqual({
            status: "dependencies_pending",
            pendingDependencies: ["RF-1"],
          });
          expect(store.byKey("RF-2").status).toBe("blocked");
        },
      );

      it.each([["todo"], ["blocked"]] as const)("allows %s while dependencies are pending", async (status) => {
        const dependency = seedTask("RF-1");
        const task = seedTask("RF-2", { assigneeId: mona.id, status: "in_progress" });
        dependOn(task, dependency);
        expect(await updateTask(deps, mona, "shop", "RF-2", { status })).toMatchObject({ task: { status } });
      });
    });

    describe("assigneeLogin (reassign)", () => {
      it("lets an admin reassign to a participant without touching the status", async () => {
        seedTask("RF-1", { assigneeId: mona.id, status: "in_review" });
        expect(await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "Bob" })).toMatchObject({
          status: "ok",
          task: { assignee: assigneeOf(bob), status: "in_review" },
        });
      });

      it("unassigns with null", async () => {
        seedTask("RF-1", { assigneeId: mona.id, status: "in_progress" });
        expect(await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: null })).toMatchObject({
          task: { assignee: null, status: "in_progress" },
        });
      });

      it("forbids members, even to assign themselves", async () => {
        seedTask("RF-1");
        expect(await updateTask(deps, mona, "shop", "RF-1", { assigneeLogin: "mona" })).toEqual({
          status: "forbidden",
        });
        expect(store.byKey("RF-1").assigneeId).toBeNull();
      });

      it.each([["eve"], ["ghost"], ["not a login"], [42]])("rejects %j as assignee", async (assigneeLogin) => {
        seedTask("RF-1");
        expect(await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin })).toEqual({
          status: "invalid_assignee",
        });
      });

      it("refuses to assign while dependencies are pending, but allows unassigning", async () => {
        const dependency = seedTask("RF-1");
        const task = seedTask("RF-2", { assigneeId: mona.id });
        dependOn(task, dependency);

        expect(await updateTask(deps, admin, "shop", "RF-2", { assigneeLogin: "bob" })).toEqual({
          status: "dependencies_pending",
          pendingDependencies: ["RF-1"],
        });
        expect(await updateTask(deps, admin, "shop", "RF-2", { assigneeLogin: null })).toMatchObject({
          status: "ok",
        });
      });
    });
  });

  describe("addTaskDependency", () => {
    it("adds the dependency and returns the task depended on", async () => {
      const api = seedTask("RF-1");
      const ui = seedTask("RF-2");

      expect(await addTaskDependency(deps, mona, "shop", "rf-2", "rf-1")).toEqual({
        status: "created",
        dependency: { key: "RF-1", title: "Task RF-1", status: "todo" },
      });
      expect(store.dependencies).toEqual([{ taskId: ui.id, dependsOnTaskId: api.id }]);
      expect(store.projectLocks).toEqual(["shop"]);
    });

    it("rejects a self-dependency", async () => {
      seedTask("RF-1");
      expect(await addTaskDependency(deps, mona, "shop", "RF-1", "rf-1")).toEqual({ status: "self_dependency" });
    });

    it("rejects a non-string key", async () => {
      seedTask("RF-1");
      expect(await addTaskDependency(deps, mona, "shop", "RF-1", 7)).toEqual({
        status: "invalid",
        field: "dependsOnKey",
      });
    });

    it("reports either task missing from the project as not found", async () => {
      seedTask("RF-1");
      store.tasks.push({ ...store.byKey("RF-1"), id: 70, projectId: OTHER_PROJECT_ID, key: "BL-1" });
      expect(await addTaskDependency(deps, mona, "shop", "RF-1", "BL-1")).toEqual({ status: "task_not_found" });
      expect(await addTaskDependency(deps, mona, "shop", "RF-9", "RF-1")).toEqual({ status: "task_not_found" });
      expect(store.dependencies).toEqual([]);
    });

    it("rejects an existing dependency", async () => {
      seedTask("RF-1");
      seedTask("RF-2");
      await addTaskDependency(deps, mona, "shop", "RF-2", "RF-1");
      expect(await addTaskDependency(deps, mona, "shop", "RF-2", "RF-1")).toEqual({
        status: "dependency_exists",
      });
    });

    it("rejects a dependency that would close a cycle", async () => {
      const one = seedTask("RF-1");
      const two = seedTask("RF-2");
      const three = seedTask("RF-3");
      dependOn(three, two);
      dependOn(two, one);

      expect(await addTaskDependency(deps, mona, "shop", "RF-1", "RF-3")).toEqual({
        status: "dependency_cycle",
      });
      expect(store.dependencies).toHaveLength(2);
    });
  });

  describe("removeTaskDependency", () => {
    it("removes the dependency", async () => {
      const api = seedTask("RF-1");
      const ui = seedTask("RF-2");
      dependOn(ui, api);

      expect(await removeTaskDependency(deps, bob, "shop", "rf-2", "rf-1")).toEqual({ status: "removed" });
      expect(store.dependencies).toEqual([]);
    });

    it("reports an absent dependency or task", async () => {
      seedTask("RF-1");
      seedTask("RF-2");
      expect(await removeTaskDependency(deps, bob, "shop", "RF-2", "RF-1")).toEqual({
        status: "dependency_not_found",
      });
      expect(await removeTaskDependency(deps, bob, "shop", "RF-2", "RF-9")).toEqual({
        status: "task_not_found",
      });
      expect(await removeTaskDependency(deps, bob, "shop", "RF-9", "RF-1")).toEqual({
        status: "task_not_found",
      });
    });
  });

  describe("deleteTask", () => {
    it("lets an admin delete a task, its dependency edges and pull request links", async () => {
      const api = seedTask("RF-1");
      const target = seedTask("RF-2");
      const ui = seedTask("RF-3");
      const other = seedTask("RF-4");
      dependOn(target, api);
      dependOn(ui, target);
      dependOn(other, api);
      linkPullRequest(target, { number: 12 });
      linkPullRequest(other, { number: 13 });

      expect(await deleteTask(deps, admin, "shop", "rf-2")).toEqual({ status: "deleted" });

      expect(store.tasks.map((t) => t.key)).toEqual(["RF-1", "RF-3", "RF-4"]);
      expect(store.dependencies).toEqual([{ taskId: other.id, dependsOnTaskId: api.id }]);
      expect(store.pullRequests.map((pr) => pr.number)).toEqual([13]);
      expect(store.projectLocks).toEqual(["shop"]);
      expect(store.taskLocks).toContain("RF-2");
    });

    it("forbids project members, and members outside the project", async () => {
      seedTask("RF-1");
      expect(await deleteTask(deps, mona, "shop", "RF-1")).toEqual({ status: "forbidden" });
      expect(await deleteTask(deps, outsider, "shop", "RF-1")).toEqual({ status: "forbidden" });
      expect(store.tasks).toHaveLength(1);
    });

    it("reports an unknown project or task", async () => {
      seedTask("RF-1");
      expect(await deleteTask(deps, admin, "ghost", "RF-1")).toEqual({ status: "project_not_found" });
      expect(await deleteTask(deps, mona, "ghost", "RF-1")).toEqual({ status: "project_not_found" });
      expect(await deleteTask(deps, admin, "shop", "RF-9")).toEqual({ status: "task_not_found" });
    });

    it("never reuses the key of a deleted latest task", async () => {
      await createTask(deps, admin, "shop", { title: "One" });
      await createTask(deps, admin, "shop", { title: "Two" });
      await createTask(deps, admin, "shop", { title: "Three" });

      expect(await deleteTask(deps, admin, "shop", "RF-3")).toEqual({ status: "deleted" });

      expect(await createTask(deps, admin, "shop", { title: "Four" })).toMatchObject({
        status: "created",
        task: { key: "RF-4" },
      });
    });
  });

  describe("listParticipants", () => {
    it("lists configured admins and project members who signed in, sorted by login", async () => {
      store.projectMembers.push({ projectId: PROJECT_ID, githubLogin: "neverloggedin" });
      deps = { ...deps, adminLogins: ["octocat", "ghostadmin"] };

      const result = await listParticipants(deps, mona, "shop");

      expect(result).toEqual({
        status: "ok",
        participants: [assigneeOf(bob), assigneeOf(mona), assigneeOf(admin)],
      });
    });

    it("lists each participant once, even an admin who is also a project member", async () => {
      store.projectMembers.push({ projectId: PROJECT_ID, githubLogin: "octocat" });

      const result = await listParticipants(deps, admin, "shop");

      expect(result.status === "ok" && result.participants.map((p) => p.login)).toEqual(["bob", "Mona", "OctoCat"]);
    });
  });

  describe("API token viewers", () => {
    const shopToken: ApiTokenViewer = { kind: "api_token", projectId: PROJECT_ID };
    const blogToken: ApiTokenViewer = { kind: "api_token", projectId: OTHER_PROJECT_ID };

    beforeEach(() => {
      seedTask("RF-1");
    });

    it("lists the tasks of the token's project, never takeable", async () => {
      const result = await listTasks(deps, shopToken, "SHOP");
      expect(result.status === "ok" && result.tasks.map((t) => [t.key, t.canTake])).toEqual([["RF-1", false]]);
    });

    it("describes a task of the token's project, never takeable", async () => {
      const result = await getTask(deps, shopToken, "shop", "rf-1");
      expect(result).toMatchObject({ status: "ok", task: { key: "RF-1", canTake: false } });
    });

    it("lists the participants of the token's project", async () => {
      const result = await listParticipants(deps, shopToken, "shop");
      expect(result.status).toBe("ok");
    });

    it.each([
      ["listTasks", () => listTasks(deps, blogToken, "shop")],
      ["getTask", () => getTask(deps, blogToken, "shop", "RF-1")],
      ["listParticipants", () => listParticipants(deps, blogToken, "shop")],
    ] as const)("%s hides other projects as project_not_found", async (_, call) => {
      expect(await call()).toEqual({ status: "project_not_found" });
    });
  });
});

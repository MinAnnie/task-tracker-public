import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskStore, type StoredTask } from "../../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import type { AuthenticatedUser } from "./sessions.ts";
import type { TaskStore } from "./task-store.ts";
import { createTask, deleteTask, removeTaskDependency, takeTask, updateTask, type TasksDeps } from "./tasks.ts";

const PROJECT_ID = 3;
const QUIET_PROJECT_ID = 4;
const CHANNEL = "998877";
const target = { channelId: CHANNEL, projectSlug: "shop" };

const user = (id: number, githubLogin: string, role: "admin" | "member"): AuthenticatedUser => ({
  id,
  githubLogin,
  name: null,
  avatarUrl: null,
  role,
});

const admin = user(1, "OctoCat", "admin");
const mona = user(2, "Mona", "member");
const bob = user(3, "bob", "member");
const ADMIN_DISCORD = "111111111111111111";
const MONA_DISCORD = "222222222222222222";
const BOB_DISCORD = "333333333333333333";
const unassigned = { assigneeLogin: null, assigneeDiscordUserId: null, ping: false };

describe("task notifications", () => {
  let store: InMemoryTaskStore;
  let notifications: RecordingNotifications;
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
      ...fields,
    };
    store.tasks.push(task);
    return task;
  };

  const linkDiscord = (linked: AuthenticatedUser, discordUserId: string) =>
    store.discordUserIds.set(linked.id, discordUserId);

  const dependOn = (task: StoredTask, dependency: StoredTask) =>
    store.dependencies.push({ taskId: task.id, dependsOnTaskId: dependency.id });

  const unblocked = (key: string, assigneeLogin: string | null = null) => ({
    ...target,
    type: "task_unblocked",
    task: { key, title: `Task ${key}` },
    assigneeLogin,
  });

  beforeEach(() => {
    nextTaskId = 1;
    store = new InMemoryTaskStore();
    store.projects.push(
      { id: PROJECT_ID, slug: "shop", taskKeyPrefix: "RF", nextTaskNumber: 1, discordChannelId: CHANNEL },
      { id: QUIET_PROJECT_ID, slug: "quiet", taskKeyPrefix: "QT", nextTaskNumber: 1, discordChannelId: null },
    );
    store.projectMembers.push(
      { projectId: PROJECT_ID, githubLogin: "mona" },
      { projectId: PROJECT_ID, githubLogin: "bob" },
      { projectId: QUIET_PROJECT_ID, githubLogin: "mona" },
    );
    store.users.push(
      ...[admin, mona, bob].map(({ id, githubLogin, name, avatarUrl }) => ({ id, githubLogin, name, avatarUrl })),
    );
    notifications = new RecordingNotifications();
    deps = { store, adminLogins: ["octocat"], notifications };
  });

  /** Fails the test if anything is published while a transaction is still open. */
  const assertPublishedAfterCommit = () => {
    const transaction = store.transaction.bind(store);
    store.transaction = async <T>(work: (tx: TaskStore) => Promise<T>) => {
      const before = notifications.events.length;
      const result = await transaction(work);
      expect(notifications.events).toHaveLength(before);
      return result;
    };
  };

  describe("createTask", () => {
    it("announces every created task after its transaction", async () => {
      assertPublishedAfterCommit();

      await createTask(deps, mona, "shop", { title: "Prod is down", priority: "urgent" });
      await createTask(deps, mona, "shop", { title: "Later", priority: "high" });
      await createTask(deps, bob, "shop", { title: "Default" });

      expect(notifications.events).toEqual([
        { ...target, type: "task_created", task: { key: "RF-1", title: "Prod is down" }, priority: "urgent", actorLogin: "Mona", ...unassigned },
        { ...target, type: "task_created", task: { key: "RF-2", title: "Later" }, priority: "high", actorLogin: "Mona", ...unassigned },
        { ...target, type: "task_created", task: { key: "RF-3", title: "Default" }, priority: "medium", actorLogin: "bob", ...unassigned },
      ]);
    });

    it("pings a linked assignee other than the creator", async () => {
      linkDiscord(bob, BOB_DISCORD);

      await createTask(deps, admin, "shop", { title: "Ship it", assigneeLogin: "bob" });

      expect(notifications.events).toEqual([
        {
          ...target,
          type: "task_created",
          task: { key: "RF-1", title: "Ship it" },
          priority: "medium",
          actorLogin: "OctoCat",
          assigneeLogin: "bob",
          assigneeDiscordUserId: BOB_DISCORD,
          ping: true,
        },
      ]);
    });

    it("mentions without pinging a creator who assigns the task to themselves", async () => {
      linkDiscord(mona, MONA_DISCORD);

      await createTask(deps, mona, "shop", { title: "Mine", assigneeLogin: "mona" });

      expect(notifications.events).toEqual([
        expect.objectContaining({ assigneeLogin: "Mona", assigneeDiscordUserId: MONA_DISCORD, ping: false }),
      ]);
    });

    it("names an unlinked assignee without a Discord id or ping", async () => {
      await createTask(deps, admin, "shop", { title: "Ship it", assigneeLogin: "bob" });

      expect(notifications.events).toEqual([
        expect.objectContaining({ assigneeLogin: "bob", assigneeDiscordUserId: null, ping: false }),
      ]);
    });

    it("stays silent for projects without a channel", async () => {
      await createTask(deps, mona, "quiet", { title: "Prod is down", priority: "urgent" });
      expect(notifications.events).toEqual([]);
    });

    it("stays silent when creation fails", async () => {
      await createTask(deps, mona, "shop", { title: "Prod is down", priority: "urgent", assigneeLogin: "ghost" });
      await createTask(deps, mona, "ghost", { title: "Prod is down", priority: "urgent" });
      expect(notifications.events).toEqual([]);
    });
  });

  describe("takeTask", () => {
    it("announces who took the task", async () => {
      seedTask("RF-1");
      assertPublishedAfterCommit();

      await takeTask(deps, bob, "shop", "RF-1");

      expect(notifications.events).toEqual([
        {
          ...target,
          type: "task_taken",
          task: { key: "RF-1", title: "Task RF-1" },
          assigneeLogin: "bob",
          assigneeDiscordUserId: null,
          ping: false,
          actorLogin: "bob",
        },
      ]);
    });

    it("mentions a linked taker without pinging them", async () => {
      linkDiscord(bob, BOB_DISCORD);
      seedTask("RF-1");

      await takeTask(deps, bob, "shop", "RF-1");

      expect(notifications.events).toEqual([
        expect.objectContaining({ type: "task_taken", assigneeLogin: "bob", assigneeDiscordUserId: BOB_DISCORD, ping: false }),
      ]);
    });

    it("stays silent when taking fails", async () => {
      const dependency = seedTask("RF-1");
      dependOn(seedTask("RF-2"), dependency);
      seedTask("RF-3", { assigneeId: mona.id, status: "in_progress" });
      seedTask("RF-4", { status: "done" });

      for (const key of ["RF-2", "RF-3", "RF-4", "RF-9"]) {
        expect(await takeTask(deps, bob, "shop", key)).not.toMatchObject({ status: "ok" });
      }
      expect(notifications.events).toEqual([]);
    });

    it("stays silent for projects without a channel", async () => {
      seedTask("QT-1", { projectId: QUIET_PROJECT_ID });
      expect(await takeTask(deps, mona, "quiet", "QT-1")).toMatchObject({ status: "ok" });
      expect(notifications.events).toEqual([]);
    });
  });

  describe("updateTask", () => {
    it("announces an admin assigning the task", async () => {
      seedTask("RF-1");

      await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "bob" });

      expect(notifications.events).toEqual([
        {
          ...target,
          type: "task_taken",
          task: { key: "RF-1", title: "Task RF-1" },
          assigneeLogin: "bob",
          assigneeDiscordUserId: null,
          ping: false,
          actorLogin: "OctoCat",
        },
      ]);
    });

    it("pings a linked assignee when an admin assigns the task to them", async () => {
      linkDiscord(bob, BOB_DISCORD);
      seedTask("RF-1");

      await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "bob", title: "Renamed" });

      expect(notifications.events).toEqual([
        {
          ...target,
          type: "task_taken",
          task: { key: "RF-1", title: "Renamed" },
          assigneeLogin: "bob",
          assigneeDiscordUserId: BOB_DISCORD,
          ping: true,
          actorLogin: "OctoCat",
        },
      ]);
    });

    it("mentions without pinging an admin who assigns the task to themselves", async () => {
      linkDiscord(admin, ADMIN_DISCORD);
      seedTask("RF-1");

      await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "octocat" });

      expect(notifications.events).toEqual([
        expect.objectContaining({ type: "task_taken", assigneeDiscordUserId: ADMIN_DISCORD, ping: false }),
      ]);
    });

    it("drops a stored Discord id that is not a snowflake", async () => {
      linkDiscord(bob, "<@&123456789012345678>");
      seedTask("RF-1");

      await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "bob" });

      expect(notifications.events).toEqual([
        expect.objectContaining({ type: "task_taken", assigneeLogin: "bob", assigneeDiscordUserId: null, ping: false }),
      ]);
    });

    it("stays silent when unassigning or re-assigning the same person", async () => {
      seedTask("RF-1", { assigneeId: bob.id, status: "in_progress" });
      seedTask("RF-2", { assigneeId: bob.id, status: "in_progress" });

      await updateTask(deps, admin, "shop", "RF-1", { assigneeLogin: "BOB" });
      await updateTask(deps, admin, "shop", "RF-2", { assigneeLogin: null });

      expect(notifications.events).toEqual([]);
    });

    it("announces dependents whose last pending dependency got done", async () => {
      const api = seedTask("RF-1", { assigneeId: mona.id, status: "in_review" });
      const ui = seedTask("RF-2");
      const docs = seedTask("RF-3", { assigneeId: bob.id });
      dependOn(ui, api);
      dependOn(docs, api);
      assertPublishedAfterCommit();

      await updateTask(deps, mona, "shop", "RF-1", { status: "done" });

      expect(notifications.events).toEqual([unblocked("RF-2"), unblocked("RF-3", "bob")]);
    });

    it("does not announce dependents still blocked, already done, or unaffected changes", async () => {
      const api = seedTask("RF-1", { assigneeId: mona.id, status: "in_review" });
      const other = seedTask("RF-2");
      const blocked = seedTask("RF-3");
      const finished = seedTask("RF-4", { status: "done" });
      dependOn(blocked, api);
      dependOn(blocked, other);
      dependOn(finished, api);

      await updateTask(deps, mona, "shop", "RF-1", { status: "in_progress" });
      await updateTask(deps, mona, "shop", "RF-1", { title: "Renamed" });
      await updateTask(deps, mona, "shop", "RF-1", { status: "done" });
      // Already done: saving `done` again unblocks nothing new.
      await updateTask(deps, mona, "shop", "RF-1", { status: "done" });

      expect(notifications.events).toEqual([]);
    });

    it("stays silent for projects without a channel", async () => {
      const api = seedTask("QT-1", { projectId: QUIET_PROJECT_ID, assigneeId: mona.id, status: "in_review" });
      dependOn(seedTask("QT-2", { projectId: QUIET_PROJECT_ID }), api);

      await updateTask(deps, mona, "quiet", "QT-1", { status: "done" });

      expect(notifications.events).toEqual([]);
    });
  });

  describe("removeTaskDependency", () => {
    it("announces the task when its last pending dependency is removed", async () => {
      const ui = seedTask("RF-2");
      dependOn(ui, seedTask("RF-1"));
      dependOn(ui, seedTask("RF-3", { status: "done" }));
      assertPublishedAfterCommit();

      expect(await removeTaskDependency(deps, bob, "shop", "RF-2", "RF-1")).toEqual({ status: "removed" });

      expect(notifications.events).toEqual([unblocked("RF-2")]);
      expect(store.taskLocks).toContain("RF-2");
    });

    it("stays silent when the task was not blocked, stays blocked, or is done", async () => {
      const ui = seedTask("RF-2");
      dependOn(ui, seedTask("RF-1", { status: "done" }));
      const blocked = seedTask("RF-4");
      dependOn(blocked, seedTask("RF-5"));
      dependOn(blocked, seedTask("RF-6"));
      const finished = seedTask("RF-7", { status: "done" });
      dependOn(finished, seedTask("RF-8"));

      await removeTaskDependency(deps, bob, "shop", "RF-2", "RF-1");
      await removeTaskDependency(deps, bob, "shop", "RF-4", "RF-5");
      await removeTaskDependency(deps, bob, "shop", "RF-7", "RF-8");
      await removeTaskDependency(deps, bob, "shop", "RF-4", "RF-9");

      expect(notifications.events).toEqual([]);
    });
  });
  describe("deleteTask", () => {
    it("announces the dependents left without pending dependencies, after the commit", async () => {
      const deleted = seedTask("RF-1");
      const freed = seedTask("RF-3", { assigneeId: bob.id, status: "in_progress" });
      dependOn(freed, deleted);
      dependOn(freed, seedTask("RF-2", { status: "done" }));
      const stillBlocked = seedTask("RF-4");
      dependOn(stillBlocked, deleted);
      dependOn(stillBlocked, seedTask("RF-5"));
      const finished = seedTask("RF-6", { status: "done" });
      dependOn(finished, deleted);
      const alsoFreed = seedTask("RF-10");
      dependOn(alsoFreed, deleted);
      assertPublishedAfterCommit();

      expect(await deleteTask(deps, admin, "shop", "RF-1")).toEqual({ status: "deleted" });

      expect(notifications.events).toEqual([unblocked("RF-3", "bob"), unblocked("RF-10")]);
      expect(store.taskLocks).toEqual(expect.arrayContaining(["RF-1", "RF-3", "RF-4", "RF-6", "RF-10"]));
    });

    it("stays silent when the deleted task was done, or the project has no channel", async () => {
      const done = seedTask("RF-1", { status: "done" });
      dependOn(seedTask("RF-2"), done);
      const quietDep = seedTask("QT-1", { projectId: QUIET_PROJECT_ID });
      dependOn(seedTask("QT-2", { projectId: QUIET_PROJECT_ID }), quietDep);

      await deleteTask(deps, admin, "shop", "RF-1");
      await deleteTask(deps, admin, "quiet", "QT-1");

      expect(notifications.events).toEqual([]);
    });
  });
});

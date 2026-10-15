import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskStore, type StoredTask } from "../../../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../../../test/fakes/recording-notifications.ts";
import type { DiscordCallerResult } from "../../application/discord-caller.ts";
import type { AuthenticatedUser } from "../../application/sessions.ts";
import { getTask, listTasks, releaseTask, takeTask, type TasksDeps } from "../../application/tasks.ts";
import { createDiscordInteractionHandler, type DiscordInteractionDeps } from "./handle-interaction.ts";

const PROJECT_ID = 3;
const CHANNEL = "222222222222222222";
const BASE = "https://tasks.example.com";

const user = (id: number, githubLogin: string, role: "admin" | "member"): AuthenticatedUser => ({
  id,
  githubLogin,
  name: null,
  avatarUrl: null,
  role,
});

const admin = user(1, "octocat", "admin");
const mona = user(2, "Mona", "member");
const bob = user(3, "bob_the_builder", "member");
const outsider = user(4, "eve", "member");

const command = (name: string, options: { name: string; value: string }[] = [], discordUser = "1001") => ({
  type: 2,
  channel_id: CHANNEL,
  member: { user: { id: discordUser } },
  data: { name, type: 1, options },
});

const keyed = (name: string, key: string) => command(name, [{ name: "key", value: key }]);

const autocomplete = (name: string, value: string) => ({
  type: 4,
  channel_id: CHANNEL,
  member: { user: { id: "1001" } },
  data: { name, type: 1, options: [{ type: 3, name: "key", value, focused: true }] },
});

const message = (content: string) => ({
  type: 4,
  data: { content, flags: 64, allowed_mentions: { parse: [] } },
});

describe("createDiscordInteractionHandler", () => {
  let store: InMemoryTaskStore;
  let notifications: RecordingNotifications;
  let caller: DiscordCallerResult;
  let callerRequests: [string, string][];
  let handle: (interaction: unknown) => Promise<unknown>;
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
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...fields,
    };
    store.tasks.push(task);
    return task;
  };

  const dependOn = (task: StoredTask, dependency: StoredTask) =>
    store.dependencies.push({ taskId: task.id, dependsOnTaskId: dependency.id });

  const content = async (interaction: unknown) => {
    const response = (await handle(interaction)) as { type: number; data: { content: string } };
    expect(response).toEqual(message(expect.any(String) as unknown as string));
    return response.data.content;
  };

  const as = (u: AuthenticatedUser) => {
    caller = { status: "ok", user: u, project: { slug: "shop", name: "Shop" } };
  };

  beforeEach(() => {
    nextTaskId = 1;
    store = new InMemoryTaskStore();
    notifications = new RecordingNotifications();
    store.projects.push({ id: PROJECT_ID, slug: "shop", taskKeyPrefix: "RF", nextTaskNumber: 1, discordChannelId: CHANNEL });
    store.projectMembers.push({ projectId: PROJECT_ID, githubLogin: "mona" }, { projectId: PROJECT_ID, githubLogin: "bob_the_builder" });
    store.users.push(
      ...[admin, mona, bob, outsider].map(({ id, githubLogin, name, avatarUrl }) => ({ id, githubLogin, name, avatarUrl })),
    );
    callerRequests = [];
    as(mona);
    const tasksDeps: TasksDeps = { store, adminLogins: ["octocat"], notifications };
    const deps: DiscordInteractionDeps = {
      appBaseUrl: BASE,
      resolveCaller: async (discordUserId, channelId) => {
        callerRequests.push([discordUserId, channelId]);
        return caller;
      },
      listTasks: (u, slug) => listTasks(tasksDeps, u, slug),
      getTask: (u, slug, key) => getTask(tasksDeps, u, slug, key),
      takeTask: (u, slug, key) => takeTask(tasksDeps, u, slug, key),
      releaseTask: (u, slug, key) => releaseTask(tasksDeps, u, slug, key),
    };
    handle = createDiscordInteractionHandler(deps);
  });

  it("answers PING with PONG", async () => {
    expect(await handle({ type: 1 })).toEqual({ type: 1 });
  });

  describe("identity and access", () => {
    it("resolves the caller from member.user in guilds and from user in DMs", async () => {
      await handle(command("tasks", [], "777"));
      await handle({ type: 2, channel_id: "dm-channel", user: { id: "888" }, data: { name: "tasks" } });
      expect(callerRequests).toEqual([
        ["777", CHANNEL],
        ["888", "dm-channel"],
      ]);
    });

    it("asks unlinked users to connect their Discord account", async () => {
      caller = { status: "not_linked" };
      const text = await content(command("tasks"));
      expect(text).toContain("Connect your Discord account first");
      expect(text).toContain(BASE);
      expect(text).toContain("Connect Discord");
    });

    it("refuses linked users who lost access", async () => {
      caller = { status: "no_access" };
      expect(await content(command("mine"))).toBe("You don't have access to Task Tracker.");
    });

    it("explains a channel without a project", async () => {
      caller = { status: "channel_not_linked" };
      expect(await content(keyed("take", "RF-1"))).toBe(
        "This channel isn't linked to a project. An admin can set it in the project settings.",
      );
    });

    it("refuses users who are not part of the project, like the web", async () => {
      as(outsider);
      seedTask("RF-1");
      for (const interaction of [command("tasks"), command("mine"), keyed("task", "RF-1"), keyed("take", "RF-1"), keyed("release", "RF-1")]) {
        expect(await content(interaction)).toBe("You're not part of Shop.");
      }
      expect(store.tasks[0]!.assigneeId).toBeNull();
    });

    it("escapes the project name", async () => {
      as(outsider);
      caller = { status: "ok", user: outsider, project: { slug: "shop", name: "*Shop*" } };
      expect(await content(command("tasks"))).toBe("You're not part of \\*Shop\\*.");
    });
  });

  describe("/tasks", () => {
    it("lists the tasks the caller can take now, sorted like the board, with links", async () => {
      seedTask("RF-1", { priority: "low", title: "Write *docs*" });
      seedTask("RF-2", { priority: "urgent" });
      seedTask("RF-3", { assigneeId: bob.id, status: "in_progress" });
      seedTask("RF-4", { status: "done" });
      const blocked = seedTask("RF-5");
      dependOn(blocked, seedTask("RF-6", { priority: "high" }));

      expect(await content(command("tasks"))).toBe(
        [
          "**Tasks you can take in Shop** (3)",
          `\`RF-2\` Task RF\\-2 · Urgent — <${BASE}/projects/shop/tasks/RF-2>`,
          `\`RF-6\` Task RF\\-6 · High — <${BASE}/projects/shop/tasks/RF-6>`,
          `\`RF-1\` Write \\*docs\\* · Low — <${BASE}/projects/shop/tasks/RF-1>`,
        ].join("\n"),
      );
    });

    it("shows at most 15 tasks and counts the rest", async () => {
      for (let n = 1; n <= 18; n++) seedTask(`RF-${n}`);
      const lines = (await content(command("tasks"))).split("\n");
      expect(lines).toHaveLength(17);
      expect(lines[15]).toContain("`RF-15`");
      expect(lines[16]).toBe("…and 3 more.");
    });

    it("stays within Discord's 2000 characters with long titles", async () => {
      for (let n = 1; n <= 15; n++) seedTask(`RF-${n}`, { title: "x".repeat(500) });
      const text = await content(command("tasks"));
      expect(text.length).toBeLessThanOrEqual(2000);
      expect(text).toMatch(/…and \d+ more\.$/);
    });

    it("has a friendly message when nothing can be taken", async () => {
      seedTask("RF-1", { assigneeId: bob.id, status: "in_progress" });
      expect(await content(command("tasks"))).toBe("Nothing to take in Shop right now.");
    });
  });

  describe("/mine", () => {
    it("lists the caller's unfinished tasks grouped by status", async () => {
      seedTask("RF-1", { assigneeId: mona.id, status: "in_progress", priority: "high" });
      seedTask("RF-2", { assigneeId: mona.id, status: "in_review" });
      seedTask("RF-3", { assigneeId: mona.id, status: "done" });
      seedTask("RF-4", { assigneeId: bob.id, status: "in_progress" });
      seedTask("RF-5", { assigneeId: mona.id, status: "in_progress", priority: "urgent" });

      expect(await content(command("mine"))).toBe(
        [
          "**Your tasks in Shop**",
          "**In progress**",
          `\`RF-5\` Task RF\\-5 · Urgent — <${BASE}/projects/shop/tasks/RF-5>`,
          `\`RF-1\` Task RF\\-1 · High — <${BASE}/projects/shop/tasks/RF-1>`,
          "**In review**",
          `\`RF-2\` Task RF\\-2 · Medium — <${BASE}/projects/shop/tasks/RF-2>`,
        ].join("\n"),
      );
    });

    it("says so when the caller has no unfinished tasks", async () => {
      seedTask("RF-1", { assigneeId: mona.id, status: "done" });
      expect(await content(command("mine"))).toBe("You have no unfinished tasks in Shop.");
    });
  });

  describe("/task", () => {
    it("describes a task, case-insensitively by key", async () => {
      const task = seedTask("RF-1", { status: "todo", priority: "high", title: "Checkout" });
      dependOn(task, seedTask("RF-2"));
      dependOn(task, seedTask("RF-3", { status: "done" }));

      expect(await content(keyed("task", "rf-1"))).toBe(
        [
          "`RF-1` Checkout",
          "Status: To do · Priority: High · Assignee: nobody",
          "Waiting on: `RF-2`",
          `<${BASE}/projects/shop/tasks/RF-1>`,
        ].join("\n"),
      );
    });

    it("shows the assignee, escaped", async () => {
      seedTask("RF-1", { assigneeId: bob.id, status: "in_progress" });
      expect(await content(keyed("task", "RF-1"))).toContain("Assignee: bob\\_the\\_builder");
    });

    it("reports an unknown key", async () => {
      expect(await content(keyed("task", "RF-*9"))).toBe("There's no task RF\\-\\*9 in Shop.");
    });
  });

  describe("/take", () => {
    it("takes the task through the take use case, which notifies the channel", async () => {
      const task = seedTask("RF-1", { title: "Checkout" });

      expect(await content(keyed("take", "rf-1"))).toBe(
        `You took \`RF-1\` Checkout. — <${BASE}/projects/shop/tasks/RF-1>`,
      );
      expect(task.assigneeId).toBe(mona.id);
      expect(task.status).toBe("in_progress");
      expect(notifications.events).toEqual([expect.objectContaining({ type: "task_taken", assigneeLogin: "Mona" })]);
    });

    it("says who already has the task", async () => {
      seedTask("RF-1", { assigneeId: bob.id, status: "in_progress" });
      expect(await content(keyed("take", "RF-1"))).toBe("`RF-1` is already taken by bob\\_the\\_builder.");
    });

    it("tells callers they already have the task", async () => {
      seedTask("RF-1", { assigneeId: mona.id, status: "in_progress" });
      expect(await content(keyed("take", "RF-1"))).toBe("You already have `RF-1`.");
    });

    it("lists the pending dependencies", async () => {
      const task = seedTask("RF-1");
      dependOn(task, seedTask("RF-3"));
      dependOn(task, seedTask("RF-2"));
      expect(await content(keyed("take", "RF-1"))).toBe(
        "`RF-1` is waiting on `RF-2`, `RF-3`. Those need to be done first.",
      );
      expect(task.assigneeId).toBeNull();
    });

    it("refuses done and unknown tasks", async () => {
      seedTask("RF-1", { status: "done" });
      expect(await content(keyed("take", "RF-1"))).toBe("`RF-1` is already done.");
      expect(await content(keyed("take", "RF-9"))).toBe("There's no task RF\\-9 in Shop.");
    });
  });

  describe("/release", () => {
    it("releases the caller's task through the release use case", async () => {
      const task = seedTask("RF-1", { assigneeId: mona.id, status: "in_progress", title: "Checkout" });
      expect(await content(keyed("release", "RF-1"))).toBe("You released `RF-1` Checkout.");
      expect(task.assigneeId).toBeNull();
      expect(task.status).toBe("todo");
    });

    it("lets admins release anyone's task, like the web", async () => {
      as(admin);
      const task = seedTask("RF-1", { assigneeId: bob.id, status: "in_progress" });
      expect(await content(keyed("release", "RF-1"))).toBe("You released `RF-1` Task RF\\-1.");
      expect(task.assigneeId).toBeNull();
    });

    it("refuses members releasing someone else's task", async () => {
      const task = seedTask("RF-1", { assigneeId: bob.id, status: "in_progress" });
      expect(await content(keyed("release", "RF-1"))).toBe(
        "Only bob\\_the\\_builder (the assignee) or an admin can release `RF-1`.",
      );
      expect(task.assigneeId).toBe(bob.id);
    });

    it("refuses unassigned and unknown tasks", async () => {
      seedTask("RF-1");
      expect(await content(keyed("release", "RF-1"))).toBe("`RF-1` isn't assigned to anyone.");
      expect(await content(keyed("release", "RF-9"))).toBe("There's no task RF\\-9 in Shop.");
    });
  });

  describe("unexpected input", () => {
    it("answers unknown commands and interaction types with an ephemeral message", async () => {
      expect(await content(command("deploy"))).toBe("Unknown command.");
      expect(await content({ type: 5, channel_id: CHANNEL, member: { user: { id: "1" } }, data: {} })).toBe(
        "Unknown command.",
      );
      expect(await content({ type: 2 })).toBe("Unknown command.");
    });

    it("asks for a key when a task command has none", async () => {
      expect(await content(command("take"))).toBe("Give a task key, e.g. `/take key:RF-14`.");
    });
  });

  describe("autocomplete", () => {
    const choices = async (interaction: unknown) => {
      const response = (await handle(interaction)) as { type: number; data: { choices: unknown[] } };
      expect(response.type).toBe(8);
      return response.data.choices;
    };

    it("suggests takeable tasks for /take matching the typed key prefix", async () => {
      seedTask("RF-1");
      seedTask("RF-12", { priority: "high" });
      seedTask("RF-13", { assigneeId: bob.id, status: "in_progress" });
      seedTask("RF-2");

      expect(await choices(autocomplete("take", "rf-1"))).toEqual([
        { name: "RF-12 Task RF-12", value: "RF-12" },
        { name: "RF-1 Task RF-1", value: "RF-1" },
      ]);
    });

    it("matches titles too and suggests the caller's tasks for /release", async () => {
      seedTask("RF-1", { assigneeId: mona.id, status: "in_progress", title: "Checkout page" });
      seedTask("RF-2", { assigneeId: bob.id, status: "in_progress", title: "Checkout API" });
      expect(await choices(autocomplete("release", "checkout"))).toEqual([
        { name: "RF-1 Checkout page", value: "RF-1" },
      ]);
    });

    it("suggests every task for /task, at most 25, with names of at most 100 characters", async () => {
      for (let n = 1; n <= 30; n++) seedTask(`RF-${n}`, { title: "y".repeat(150), status: "done" });
      const result = (await choices(autocomplete("task", ""))) as { name: string }[];
      expect(result).toHaveLength(25);
      for (const choice of result) expect([...choice.name].length).toBeLessThanOrEqual(100);
    });

    it("suggests nothing to callers without access", async () => {
      seedTask("RF-1");
      caller = { status: "not_linked" };
      expect(await choices(autocomplete("take", ""))).toEqual([]);
      as(outsider);
      expect(await choices(autocomplete("take", ""))).toEqual([]);
    });
  });
});

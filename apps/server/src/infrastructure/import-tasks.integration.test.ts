import { asc, eq, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import { handlePullRequestEvent } from "../application/handle-pull-request-event.ts";
import { importTasks } from "../application/import-tasks.ts";
import type { AuthenticatedUser } from "../application/sessions.ts";
import type { TaskStore } from "../application/task-store.ts";
import { createTask } from "../application/tasks.ts";
import { createDb } from "../db/client.ts";
import { projects, repositories, taskDependencies, taskPullRequests, tasks, users } from "../db/schema.ts";
import { extractTaskKeys } from "../domain/index.ts";
import { createDrizzlePullRequestWebhookStore } from "./drizzle-pull-request-webhook-store.ts";
import { createDrizzleTaskStore } from "./drizzle-task-store.ts";

const { sql, db } = createDb(testDatabaseUrl);
const store = createDrizzleTaskStore(db);
const notifications = new RecordingNotifications();

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const FILE = {
  tasks: [
    { ref: "monorepo", title: "Monorepo", priority: "urgent", stage: "Etapa 0", description: "Setup", dependsOn: [] },
    { ref: "prisma", title: "Prisma schema", priority: "high", dependsOn: ["monorepo"] },
    { key: "RF-02", title: "Auth0 login", priority: "high", stage: "Etapa 1 · Autenticación", dependsOn: ["prisma", "monorepo"] },
    { key: "RF-03", title: "Roles", dependsOn: ["RF-02"] },
  ],
};

const keysInOrder = async () =>
  (await db.select({ key: tasks.key }).from(tasks).orderBy(asc(tasks.id))).map((row) => row.key);

const edgeKeys = async () => {
  const rows = await db.execute<{ task: string; depends_on: string }>(rawSql`
    select t.key as task, d.key as depends_on
    from task_dependencies e join tasks t on t.id = e.task_id join tasks d on d.id = e.depends_on_task_id
    order by t.id, d.id`);
  return [...rows].map((row) => [row.task, row.depends_on]);
};

describe("importTasks (Postgres)", () => {
  let shop: number;

  beforeEach(async () => {
    await db.execute(
      rawSql`truncate table task_dependencies, project_members, members, sessions, task_pull_requests, pull_requests, tasks, repositories, users, projects restart identity cascade`,
    );
    const [row] = await db
      .insert(projects)
      .values({ slug: "shop", name: "Shop", taskKeyPrefix: "AX", discordChannelId: "42" })
      .returning({ id: projects.id });
    shop = row!.id;
    notifications.events = [];
  });

  it("creates the tasks in file order and their dependencies, then announces one summary", async () => {
    const result = await importTasks({ store, notifications }, "shop", FILE);

    expect(result).toMatchObject({ status: "imported", plan: { dependencyCount: 4, explicitKeyCount: 2 } });
    expect(await keysInOrder()).toEqual(["AX-1", "AX-2", "RF-02", "RF-03"]);
    expect(await edgeKeys()).toEqual([
      ["AX-2", "AX-1"],
      ["RF-02", "AX-1"],
      ["RF-02", "AX-2"],
      ["RF-03", "RF-02"],
    ]);
    const [auth] = await db.select().from(tasks).where(eq(tasks.key, "RF-02"));
    expect(auth).toMatchObject({
      status: "todo",
      assigneeId: null,
      priority: "high",
      stage: "Etapa 1 · Autenticación",
      description: null,
    });
    expect(notifications.events).toEqual([
      { channelId: "42", projectSlug: "shop", type: "tasks_imported", count: 4, explicitKeyCount: 2, doneCount: 0 },
    ]);
  });

  it("persists the imported statuses and counts the done tasks in the summary", async () => {
    const file = {
      tasks: [
        { key: "AUTH-07", title: "Login", status: "done" },
        { key: "AUTH-08b", title: "Return URL", status: "done", dependsOn: ["AUTH-07"] },
        { key: "AUTH-09", title: "Roles", status: "blocked", dependsOn: ["AUTH-08B"] },
        { ref: "docs", title: "Docs" },
      ],
    };
    expect(await importTasks({ store, notifications }, "shop", file)).toMatchObject({ status: "imported" });

    const rows = await db.select({ key: tasks.key, status: tasks.status, assigneeId: tasks.assigneeId }).from(tasks).orderBy(asc(tasks.id));
    expect(rows).toEqual([
      { key: "AUTH-07", status: "done", assigneeId: null },
      { key: "AUTH-08B", status: "done", assigneeId: null },
      { key: "AUTH-09", status: "blocked", assigneeId: null },
      { key: "AX-1", status: "todo", assigneeId: null },
    ]);
    expect(notifications.events).toEqual([
      { channelId: "42", projectSlug: "shop", type: "tasks_imported", count: 4, explicitKeyCount: 3, doneCount: 2 },
    ]);
  });

  it("keeps an imported done task done when a pull request for it is opened later", async () => {
    await importTasks({ store, notifications }, "shop", {
      tasks: [
        { key: "AUTH-08", title: "Login", status: "done" },
        { key: "AUTH-08b", title: "Return URL", status: "done", dependsOn: ["AUTH-08"] },
      ],
    });
    await db.insert(repositories).values({ projectId: shop, githubFullName: "acme/shop" });

    const result = await handlePullRequestEvent(createDrizzlePullRequestWebhookStore(db), {
      action: "opened",
      repositoryFullName: "acme/shop",
      installationId: null,
      pullRequest: {
        number: 3,
        title: "Fix return URL",
        branch: "feat/AUTH-08b-return",
        url: "https://github.com/acme/shop/pull/3",
        authorLogin: "octocat",
        state: "open",
        merged: false,
        createdAt: new Date("2026-01-01T10:00:00Z"),
        mergedAt: null,
        closedAt: null,
      },
    });

    expect(result).toMatchObject({ status: "processed", linkedTaskKeys: ["AUTH-08B"], statusChanges: [] });
    const linked = await db
      .select({ key: tasks.key, status: tasks.status })
      .from(taskPullRequests)
      .innerJoin(tasks, eq(tasks.id, taskPullRequests.taskId));
    expect(linked).toEqual([{ key: "AUTH-08B", status: "done" }]);
  });

  it("keeps zero-padded explicit keys as given, so pull request branches link to them", async () => {
    await importTasks({ store, notifications }, "shop", FILE);
    const keys = await store.listProjectTaskKeys(shop);
    expect(extractTaskKeys("feat/RF-02-auth0", keys)).toEqual(["RF-02"]);
    expect(extractTaskKeys("feat/RF-2-auth0", keys)).toEqual([]);
  });

  it("lets task creation continue after the generated keys", async () => {
    await importTasks({ store, notifications }, "shop", FILE);
    const [user] = await db
      .insert(users)
      .values({ githubId: 1, githubLogin: "octocat", name: null, avatarUrl: null })
      .returning({ id: users.id });
    const admin: AuthenticatedUser = { id: user!.id, githubLogin: "octocat", name: null, avatarUrl: null, role: "admin" };
    const deps = { store, adminLogins: ["octocat"], notifications };

    expect(await createTask(deps, admin, "shop", { title: "Next" })).toMatchObject({ task: { key: "AX-3" } });
    expect((await db.select({ next: projects.nextTaskNumber }).from(projects))[0]?.next).toBe(4);
  });

  it("writes nothing when any write of the transaction fails", async () => {
    const failing: TaskStore = {
      ...store,
      transaction: (work) =>
        store.transaction((tx) =>
          work({
            ...tx,
            setNextTaskNumber: async () => {
              throw new Error("boom");
            },
          }),
        ),
    };

    await expect(importTasks({ store: failing, notifications }, "shop", FILE)).rejects.toThrow("boom");

    expect(await keysInOrder()).toEqual([]);
    expect(await db.select().from(taskDependencies)).toEqual([]);
    expect(notifications.events).toEqual([]);
  });

  describe("dependencies section", () => {
    const EDGES = {
      tasks: [{ ref: "dom", title: "Domain" }],
      dependencies: [
        { task: "RF-03", dependsOn: ["rf-02", "dom"] },
        { task: "rf-02", dependsOn: ["AX-2", "dom"] },
      ],
    };

    beforeEach(async () => {
      await importTasks({ store, notifications }, "shop", FILE);
      notifications.events = [];
    });

    it("writes the new tasks and every edge in one transaction, skipping existing edges on re-runs", async () => {
      const result = await importTasks({ store, notifications }, "shop", EDGES);

      expect(result).toMatchObject({ status: "imported", plan: { alreadyPresentDependencyCount: 2 } });
      expect(await keysInOrder()).toEqual(["AX-1", "AX-2", "RF-02", "RF-03", "AX-3"]);
      expect(await edgeKeys()).toEqual([
        ["AX-2", "AX-1"],
        ["RF-02", "AX-1"],
        ["RF-02", "AX-2"],
        ["RF-02", "AX-3"],
        ["RF-03", "RF-02"],
        ["RF-03", "AX-3"],
      ]);
      expect(notifications.events).toEqual([expect.objectContaining({ type: "tasks_imported", count: 1 })]);

      const rerun = await importTasks({ store, notifications }, "shop", {
        dependencies: [
          { task: "RF-03", dependsOn: ["RF-02", "AX-3"] },
          { task: "RF-02", dependsOn: ["AX-2", "ax-3"] },
        ],
      });
      expect(rerun).toMatchObject({ status: "imported", plan: { addedDependencies: [], alreadyPresentDependencyCount: 4 } });
      expect(await db.select().from(taskDependencies)).toHaveLength(6);
      expect(notifications.events).toHaveLength(1);
    });

    it("writes neither tasks nor edges when a write fails", async () => {
      const failing: TaskStore = {
        ...store,
        transaction: (work) =>
          store.transaction((tx) => {
            let calls = 0;
            return work({
              ...tx,
              addDependency: async (taskId, dependsOnTaskId) => {
                if (++calls === 2) throw new Error("boom");
                return tx.addDependency(taskId, dependsOnTaskId);
              },
            });
          }),
      };

      await expect(importTasks({ store: failing, notifications }, "shop", EDGES)).rejects.toThrow("boom");

      expect(await keysInOrder()).toEqual(["AX-1", "AX-2", "RF-02", "RF-03"]);
      expect(await db.select().from(taskDependencies)).toHaveLength(4);
      expect(notifications.events).toEqual([]);
    });

    it("writes nothing when an edge closes a cycle through existing edges", async () => {
      const result = await importTasks({ store, notifications }, "shop", {
        tasks: [{ ref: "new", title: "New" }],
        dependencies: [{ task: "AX-1", dependsOn: ["RF-03"] }],
      });
      expect(result).toMatchObject({
        status: "invalid",
        errors: [{ dependency: 1, message: 'depending on "RF-03" closes a dependency cycle' }],
      });
      expect(await keysInOrder()).toEqual(["AX-1", "AX-2", "RF-02", "RF-03"]);
      expect(await db.select().from(taskDependencies)).toHaveLength(4);
    });
  });

  it("writes nothing on validation errors or a dry run", async () => {
    const invalid = { tasks: [...FILE.tasks, { ref: "broken", title: "", dependsOn: ["ghost"] }] };
    expect(await importTasks({ store, notifications }, "shop", invalid)).toMatchObject({ status: "invalid" });
    expect(await importTasks({ store, notifications }, "shop", FILE, { dryRun: true })).toMatchObject({
      status: "planned",
    });

    expect(await keysInOrder()).toEqual([]);
    expect(notifications.events).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskStore, type StoredTask } from "../../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import { formatImportError, importTasks, type ImportTasksDeps } from "./import-tasks.ts";
import type { TaskStore } from "./task-store.ts";

const PROJECT_ID = 3;
const CHANNEL = "998877";

describe("importTasks", () => {
  let store: InMemoryTaskStore;
  let notifications: RecordingNotifications;
  let deps: ImportTasksDeps;
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

  const stored = (key: string) => store.tasks.find((t) => t.key === key);
  const edges = () =>
    store.dependencies.map((d) => [store.tasks.find((t) => t.id === d.taskId)?.key, store.tasks.find((t) => t.id === d.dependsOnTaskId)?.key]);

  /** Runs an import that must fail and returns its formatted errors. */
  const errorsOf = async (input: unknown) => {
    const result = await importTasks(deps, "shop", input);
    if (result.status !== "invalid") throw new Error(`expected invalid, got ${result.status}`);
    return result.errors.map(formatImportError);
  };

  beforeEach(() => {
    nextTaskId = 1;
    store = new InMemoryTaskStore();
    store.projects.push({ id: PROJECT_ID, slug: "shop", taskKeyPrefix: "AX", nextTaskNumber: 1, discordChannelId: CHANNEL });
    notifications = new RecordingNotifications();
    deps = { store, notifications };
  });

  it("creates every task in file order, generating keys for refs and keeping explicit keys as given", async () => {
    const result = await importTasks(deps, "shop", {
      tasks: [
        { ref: "monorepo", title: "Monorepo", priority: "urgent", stage: "Etapa 0", description: "Setup", dependsOn: [] },
        { key: "rf-02", title: "Auth", priority: "high", stage: "Etapa 1 · Autenticación", dependsOn: ["monorepo"] },
        { ref: "docs", title: "  Docs  " },
      ],
    });

    expect(result).toMatchObject({ status: "imported" });
    expect(store.tasks.map(({ key, title, priority, stage, description, status, assigneeId }) => ({
      key, title, priority, stage, description, status, assigneeId,
    }))).toEqual([
      { key: "AX-1", title: "Monorepo", priority: "urgent", stage: "Etapa 0", description: "Setup", status: "todo", assigneeId: null },
      { key: "RF-02", title: "Auth", priority: "high", stage: "Etapa 1 · Autenticación", description: null, status: "todo", assigneeId: null },
      { key: "AX-2", title: "Docs", priority: "medium", stage: null, description: null, status: "todo", assigneeId: null },
    ]);
    expect(edges()).toEqual([["RF-02", "AX-1"]]);
    expect(store.projects[0]?.nextTaskNumber).toBe(3);
    expect(store.transactions).toBe(1);
    expect(store.projectLocks).toEqual(["shop"]);
  });

  it("resolves dependencies by ref, by key in the file (any case) and by existing project key", async () => {
    seedTask("RF-01");
    await importTasks(deps, "shop", {
      tasks: [
        { key: "RF-02", title: "Two", dependsOn: ["rf-01", "infra"] },
        { ref: "infra", title: "Infra" },
        { ref: "app", title: "App", dependsOn: ["RF-02", "rf-02"] },
      ],
    });
    expect(edges()).toEqual([
      ["RF-02", "RF-01"],
      ["RF-02", "AX-1"],
      ["AX-2", "RF-02"],
    ]);
  });

  it("moves generated keys past an explicit key that uses the project's prefix", async () => {
    await importTasks(deps, "shop", { tasks: [{ ref: "a", title: "A" }, { key: "AX-7", title: "Seven" }, { ref: "b", title: "B" }] });
    expect(store.tasks.map((t) => t.key)).toEqual(["AX-8", "AX-7", "AX-9"]);
    expect(store.projects[0]?.nextTaskNumber).toBe(10);
  });

  it("moves the counter past an explicit key with the project's prefix even without refs", async () => {
    await importTasks(deps, "shop", { tasks: [{ key: "ax-04", title: "Four" }] });
    expect(stored("AX-04")).toBeDefined();
    expect(store.projects[0]?.nextTaskNumber).toBe(5);
  });

  it("continues after existing keys of the project", async () => {
    seedTask("AX-3");
    await importTasks(deps, "shop", { tasks: [{ ref: "a", title: "A" }] });
    expect(stored("AX-4")).toBeDefined();
  });

  it("publishes one summary event after the commit and no per-task event", async () => {
    const transaction = store.transaction.bind(store);
    store.transaction = async <T>(work: (tx: TaskStore) => Promise<T>) => {
      const result = await transaction(work);
      expect(notifications.events).toEqual([]);
      return result;
    };

    await importTasks(deps, "shop", {
      tasks: [{ ref: "a", title: "A", priority: "urgent" }, { key: "RF-1", title: "B" }, { key: "RF-2", title: "C" }],
    });

    expect(notifications.events).toEqual([
      { channelId: CHANNEL, projectSlug: "shop", type: "tasks_imported", count: 3, explicitKeyCount: 2, doneCount: 0 },
    ]);
  });

  describe("status", () => {
    const statuses = () => store.tasks.map((t) => [t.key, t.status, t.assigneeId]);

    it("defaults to todo and stores done and blocked as given, unassigned, in the same transaction", async () => {
      const result = await importTasks(deps, "shop", {
        tasks: [
          { key: "RF-1", title: "One", status: "done" },
          { key: "RF-2", title: "Two", status: "blocked" },
          { key: "RF-3", title: "Three", status: "todo" },
          { key: "RF-4", title: "Four" },
        ],
      });
      expect(result).toMatchObject({ status: "imported" });
      expect(statuses()).toEqual([
        ["RF-1", "done", null],
        ["RF-2", "blocked", null],
        ["RF-3", "todo", null],
        ["RF-4", "todo", null],
      ]);
      expect(store.transactions).toBe(1);
    });

    it("lets a done task depend on done tasks of the file and of the project", async () => {
      seedTask("RF-01", { status: "done" });
      const result = await importTasks(deps, "shop", {
        tasks: [
          { ref: "base", title: "Base", status: "done" },
          { key: "RF-02", title: "Two", status: "done", dependsOn: ["base", "RF-01"] },
        ],
      });
      expect(result).toMatchObject({ status: "imported" });
      expect(stored("RF-02")?.status).toBe("done");
    });

    it("lets todo and blocked tasks depend on anything", async () => {
      seedTask("RF-01", { status: "in_progress" });
      const result = await importTasks(deps, "shop", {
        tasks: [
          { ref: "a", title: "A" },
          { ref: "b", title: "B", status: "blocked", dependsOn: ["a", "RF-01"] },
          { ref: "c", title: "C", dependsOn: ["b"] },
        ],
      });
      expect(result).toMatchObject({ status: "imported" });
    });

    it("rejects a done task whose dependencies in the file or the project are not done, naming them", async () => {
      seedTask("RF-01", { status: "in_review" });
      seedTask("RF-03", { status: "done" });
      expect(
        await errorsOf({
          tasks: [
            { ref: "a", title: "A" },
            { ref: "b", title: "B", status: "blocked" },
            { ref: "c", title: "C", status: "done" },
            { key: "RF-02", title: "Two", status: "done", dependsOn: ["a", "rf-01", "c", "RF-03", "b"] },
          ],
        }),
      ).toEqual(["task #4 (RF-02): is done but depends on tasks that are not done: a, rf-01, b"]);
      expect(store.tasks.map((t) => t.key)).toEqual(["RF-01", "RF-03"]);
    });

    it("counts the done tasks in the summary event", async () => {
      await importTasks(deps, "shop", {
        tasks: [
          { key: "RF-1", title: "One", status: "done" },
          { ref: "b", title: "B", status: "done", dependsOn: ["RF-1"] },
          { ref: "c", title: "C", status: "blocked" },
        ],
      });
      expect(notifications.events).toEqual([
        { channelId: CHANNEL, projectSlug: "shop", type: "tasks_imported", count: 3, explicitKeyCount: 1, doneCount: 2 },
      ]);
    });

    it("includes each task's status in the plan", async () => {
      const result = await importTasks(
        deps,
        "shop",
        { tasks: [{ ref: "a", title: "A", status: "done" }, { ref: "b", title: "B" }] },
        { dryRun: true },
      );
      if (result.status !== "planned") throw new Error(result.status);
      expect(result.plan.tasks.map((t) => [t.key, t.status])).toEqual([
        ["AX-1", "done"],
        ["AX-2", "todo"],
      ]);
    });
  });

  describe("keys with a letter suffix", () => {
    it("accepts a single trailing letter after the number and stores it uppercased", async () => {
      const result = await importTasks(deps, "shop", {
        tasks: [{ key: "AUTH-08b", title: "Return URL" }, { ref: "x", title: "X", dependsOn: ["auth-08B"] }],
      });
      expect(result).toMatchObject({ status: "imported" });
      expect(store.tasks.map((t) => t.key)).toEqual(["AUTH-08B", "AX-1"]);
      expect(edges()).toEqual([["AX-1", "AUTH-08B"]]);
    });

    it("lets AUTH-08 and AUTH-08B coexist, in the file and against the project", async () => {
      seedTask("AUTH-08");
      const result = await importTasks(deps, "shop", {
        tasks: [{ key: "AUTH-08B", title: "B", dependsOn: ["AUTH-08"] }, { key: "AUTH-09", title: "9" }, { key: "AUTH-09a", title: "9a" }],
      });
      expect(result).toMatchObject({ status: "imported" });
      expect(store.tasks.map((t) => t.key)).toEqual(["AUTH-08", "AUTH-08B", "AUTH-09", "AUTH-09A"]);
    });

    it("does not move generated keys past a suffixed key with the project's prefix", async () => {
      await importTasks(deps, "shop", { tasks: [{ key: "AX-7b", title: "Seven b" }, { ref: "a", title: "A" }] });
      expect(store.tasks.map((t) => t.key)).toEqual(["AX-7B", "AX-1"]);
      expect(store.projects[0]?.nextTaskNumber).toBe(2);
    });

    it.each([["AUTH-08bc"], ["AUTH-08-b"], ["AUTH-b"], ["AUTH-08ñ"]])("still rejects the key %j", async (key) => {
      expect(await errorsOf({ tasks: [{ key, title: "A" }] })).toEqual([
        `task #1 (${key.toUpperCase()}): "key" must look like PREFIX-123 (1–10 letters or digits starting with a letter)`,
      ]);
    });
  });

  describe("dependencies section", () => {
    const link = (task: StoredTask, dependsOn: StoredTask) =>
      store.dependencies.push({ taskId: task.id, dependsOnTaskId: dependsOn.id });

    it("adds edges between existing tasks, case-insensitively and with suffixed keys, without creating tasks", async () => {
      seedTask("RF-12");
      seedTask("DOM-02");
      seedTask("AUTH-08B");
      const result = await importTasks(deps, "shop", {
        dependencies: [{ task: "rf-12", dependsOn: ["DOM-02", "auth-08b"] }],
      });

      expect(result).toMatchObject({
        status: "imported",
        plan: {
          tasks: [],
          addedDependencies: [
            { task: "RF-12", dependsOn: "DOM-02" },
            { task: "RF-12", dependsOn: "AUTH-08B" },
          ],
          alreadyPresentDependencyCount: 0,
        },
      });
      expect(edges()).toEqual([
        ["RF-12", "DOM-02"],
        ["RF-12", "AUTH-08B"],
      ]);
      expect(store.tasks.map((t) => t.key)).toEqual(["RF-12", "DOM-02", "AUTH-08B"]);
      expect(store.transactions).toBe(1);
      expect(store.projectLocks).toEqual(["shop"]);
    });

    it("resolves tasks of the same file by key or ref, inserting the tasks before every edge", async () => {
      seedTask("RF-12");
      const result = await importTasks(deps, "shop", {
        tasks: [{ ref: "dom", title: "Domain" }, { key: "RF-20", title: "Twenty" }],
        dependencies: [
          { task: "RF-12", dependsOn: ["dom", "rf-20"] },
          { task: "rf-20", dependsOn: ["DOM"] },
        ],
      });

      expect(result).toMatchObject({ status: "imported" });
      expect(edges()).toEqual([
        ["RF-12", "AX-1"],
        ["RF-12", "RF-20"],
        ["RF-20", "AX-1"],
      ]);
      if (result.status !== "imported") throw new Error(result.status);
      expect(result.plan.addedDependencies).toEqual([
        { task: "RF-12", dependsOn: "AX-1" },
        { task: "RF-12", dependsOn: "RF-20" },
        { task: "RF-20", dependsOn: "AX-1" },
      ]);
      expect(result.plan.dependencyCount).toBe(0);
    });

    it("skips edges that already exist and merges duplicates of the file, so re-runs are idempotent", async () => {
      const rf12 = seedTask("RF-12");
      const dom = seedTask("DOM-02");
      seedTask("DOM-03");
      link(rf12, dom);
      const file = {
        tasks: [{ ref: "x", title: "X", dependsOn: ["DOM-03"] }],
        dependencies: [
          { task: "RF-12", dependsOn: ["DOM-02", "DOM-03", "dom-03"] },
          { task: "rf-12", dependsOn: ["DOM-03"] },
          { task: "x", dependsOn: ["DOM-03"] },
        ],
      };
      const result = await importTasks(deps, "shop", file);

      if (result.status !== "imported") throw new Error(result.status);
      expect(result.plan.addedDependencies).toEqual([{ task: "RF-12", dependsOn: "DOM-03" }]);
      expect(result.plan.alreadyPresentDependencyCount).toBe(1);
      expect(edges()).toEqual([
        ["RF-12", "DOM-02"],
        ["AX-1", "DOM-03"],
        ["RF-12", "DOM-03"],
      ]);

      const rerun = await importTasks(deps, "shop", { dependencies: file.dependencies.slice(0, 2) });
      if (rerun.status !== "imported") throw new Error(rerun.status);
      expect(rerun.plan.addedDependencies).toEqual([]);
      expect(rerun.plan.alreadyPresentDependencyCount).toBe(2);
      expect(store.dependencies).toHaveLength(3);
    });

    it("rejects unknown keys and malformed entries, with the entry's index, writing nothing", async () => {
      seedTask("RF-12");
      expect(
        await errorsOf({
          tasks: [{ ref: "a", title: "" }],
          dependencies: [
            { task: "ghost", dependsOn: ["RF-12"] },
            { task: "RF-12", dependsOn: ["nope", "rf-12"] },
            { task: "RF-12" },
            "x",
            { task: "RF-12", dependsOn: [], extra: 1 },
          ],
        }),
      ).toEqual([
        'task #1 (a): "title" must have 1–200 characters',
        'dependency #1 (ghost): unknown task "ghost"',
        'dependency #2 (RF-12): unknown dependency "nope"',
        "dependency #2 (RF-12): depends on itself",
        'dependency #3 (RF-12): "dependsOn" must be a non-empty array of keys or refs',
        'dependency #4: must be an object with "task" and "dependsOn"',
        'dependency #5 (RF-12): unknown property "extra"',
        'dependency #5 (RF-12): "dependsOn" must be a non-empty array of keys or refs',
      ]);
      expect(store.tasks.map((t) => t.key)).toEqual(["RF-12"]);
      expect(store.dependencies).toEqual([]);
    });

    it("rejects a cycle through existing edges", async () => {
      const one = seedTask("RF-1");
      const two = seedTask("RF-2");
      const three = seedTask("RF-3");
      link(two, one);
      link(three, two);
      expect(await errorsOf({ dependencies: [{ task: "RF-1", dependsOn: ["RF-3"] }] })).toEqual([
        'dependency #1 (RF-1): depending on "RF-3" closes a dependency cycle',
      ]);
      expect(store.dependencies).toHaveLength(2);
    });

    it("rejects a cycle through the edges of the file's tasks", async () => {
      seedTask("RF-1");
      expect(
        await errorsOf({
          tasks: [{ ref: "a", title: "A", dependsOn: ["RF-1"] }],
          dependencies: [{ task: "RF-1", dependsOn: ["a"] }],
        }),
      ).toEqual(['dependency #1 (RF-1): depending on "a" closes a dependency cycle']);
      expect(store.tasks.map((t) => t.key)).toEqual(["RF-1"]);
    });

    it("rejects a done task gaining a dependency that is not done; other statuses may gain any", async () => {
      seedTask("RF-1", { status: "done" });
      seedTask("RF-2", { status: "in_progress" });
      seedTask("RF-3", { status: "done" });
      seedTask("RF-4", { status: "in_review" });
      expect(
        await errorsOf({
          tasks: [{ ref: "a", title: "A" }],
          dependencies: [
            { task: "RF-1", dependsOn: ["RF-3", "RF-2", "a"] },
            { task: "RF-2", dependsOn: ["RF-4"] },
            { task: "RF-4", dependsOn: ["a"] },
          ],
        }),
      ).toEqual(["dependency #1 (RF-1): is done but depends on tasks that are not done: RF-2, a"]);

      const result = await importTasks(deps, "shop", {
        dependencies: [{ task: "RF-1", dependsOn: ["RF-3"] }, { task: "RF-2", dependsOn: ["RF-4"] }],
      });
      expect(result).toMatchObject({ status: "imported" });
    });

    it("accepts an empty or missing tasks array with dependencies and posts no summary", async () => {
      seedTask("RF-1");
      seedTask("RF-2");
      expect(await importTasks(deps, "shop", { tasks: [], dependencies: [{ task: "RF-2", dependsOn: ["RF-1"] }] })).toMatchObject({
        status: "imported",
      });
      expect(edges()).toEqual([["RF-2", "RF-1"]]);
      expect(store.projects[0]?.nextTaskNumber).toBe(1);
      expect(notifications.events).toEqual([]);
    });

    it("keeps one summary for the tasks when the file also adds edges", async () => {
      seedTask("RF-1");
      await importTasks(deps, "shop", {
        tasks: [{ ref: "a", title: "A" }],
        dependencies: [{ task: "RF-1", dependsOn: ["a"] }],
      });
      expect(notifications.events).toEqual([
        { channelId: CHANNEL, projectSlug: "shop", type: "tasks_imported", count: 1, explicitKeyCount: 0, doneCount: 0 },
      ]);
    });

    it.each([
      [{}, ['file: needs a "tasks" or "dependencies" array']],
      [{ tasks: [], dependencies: [] }, ['file: "tasks" is empty']],
      [{ dependencies: [] }, ['file: needs a "tasks" or "dependencies" array']],
      [{ dependencies: {} }, ['file: "dependencies" must be an array']],
    ])("rejects the file %j", async (input, expected) => {
      expect(await errorsOf(input)).toEqual(expected);
    });

    it("plans the edges without writing on a dry run", async () => {
      seedTask("RF-1");
      seedTask("RF-2");
      const result = await importTasks(deps, "shop", { dependencies: [{ task: "RF-2", dependsOn: ["RF-1"] }] }, { dryRun: true });
      expect(result).toMatchObject({ status: "planned", plan: { addedDependencies: [{ task: "RF-2", dependsOn: "RF-1" }] } });
      expect(store.dependencies).toEqual([]);
    });
  });

  it("publishes nothing for a project without a channel", async () => {
    store.projects[0]!.discordChannelId = null;
    await importTasks(deps, "shop", { tasks: [{ ref: "a", title: "A" }] });
    expect(notifications.events).toEqual([]);
  });

  it("returns the plan without writing or notifying on a dry run", async () => {
    seedTask("RF-01");
    const result = await importTasks(
      deps,
      "shop",
      {
        tasks: [
          { ref: "monorepo", title: "Monorepo" },
          { key: "RF-02", title: "Auth", dependsOn: ["monorepo", "RF-01"] },
          { ref: "docs", title: "Docs", dependsOn: ["RF-02"] },
        ],
      },
      { dryRun: true },
    );

    expect(result).toEqual({
      status: "planned",
      plan: {
        projectSlug: "shop",
        tasks: [
          { key: "AX-1", ref: "monorepo", title: "Monorepo", priority: "medium", status: "todo", dependsOn: [] },
          { key: "RF-02", ref: null, title: "Auth", priority: "medium", status: "todo", dependsOn: ["AX-1", "RF-01"] },
          { key: "AX-2", ref: "docs", title: "Docs", priority: "medium", status: "todo", dependsOn: ["RF-02"] },
        ],
        explicitKeyCount: 1,
        dependencyCount: 3,
        roots: ["AX-1"],
        addedDependencies: [],
        alreadyPresentDependencyCount: 0,
      },
    });
    expect(store.tasks.map((t) => t.key)).toEqual(["RF-01"]);
    expect(store.dependencies).toEqual([]);
    expect(store.projects[0]?.nextTaskNumber).toBe(1);
    expect(notifications.events).toEqual([]);
  });

  it("reports an unknown project", async () => {
    expect(await importTasks(deps, "nope", { tasks: [{ ref: "a", title: "A" }] })).toEqual({ status: "project_not_found" });
  });

  describe("validation", () => {
    it.each([
      [null, ["file: must be a JSON object with a \"tasks\" array"]],
      [[], ["file: must be a JSON object with a \"tasks\" array"]],
      [{ tasks: {} }, ["file: must be a JSON object with a \"tasks\" array"]],
      [{ tasks: [] }, ["file: \"tasks\" is empty"]],
      [{ tasks: [], extra: 1 }, ["file: unknown property \"extra\"", "file: \"tasks\" is empty"]],
      [{ tasks: ["x"] }, ["task #1: must be an object"]],
    ])("rejects the file %j", async (input, expected) => {
      expect(await errorsOf(input)).toEqual(expected);
    });

    it.each([
      [{ title: "A" }, "task #1: needs either \"key\" or \"ref\""],
      [{ key: "RF-1", ref: "a", title: "A" }, "task #1 (RF-1): has both \"key\" and \"ref\""],
      [{ key: "RF1", title: "A" }, "task #1 (RF1): \"key\" must look like PREFIX-123 (1–10 letters or digits starting with a letter)"],
      [{ key: "1RF-1", title: "A" }, "task #1 (1RF-1): \"key\" must look like PREFIX-123 (1–10 letters or digits starting with a letter)"],
      [{ key: "ABCDEFGHIJK-1", title: "A" }, "task #1 (ABCDEFGHIJK-1): \"key\" must look like PREFIX-123 (1–10 letters or digits starting with a letter)"],
      [{ key: 12, title: "A" }, "task #1: \"key\" must be a string"],
      [{ ref: "  ", title: "A" }, "task #1: \"ref\" must be a non-empty string of at most 100 characters"],
      [{ ref: "a" }, "task #1 (a): \"title\" must have 1–200 characters"],
      [{ ref: "a", title: "x".repeat(201) }, "task #1 (a): \"title\" must have 1–200 characters"],
      [{ ref: "a", title: "A", description: 5 }, "task #1 (a): \"description\" must be a string of at most 10000 characters"],
      [{ ref: "a", title: "A", priority: "critical" }, "task #1 (a): \"priority\" must be one of urgent, high, medium, low"],
      [{ ref: "a", title: "A", stage: "x".repeat(51) }, "task #1 (a): \"stage\" must be a string of at most 50 characters"],
      [{ ref: "a", title: "A", dependsOn: "b" }, "task #1 (a): \"dependsOn\" must be an array of keys or refs"],
      [{ ref: "a", title: "A", dependsOn: [3] }, "task #1 (a): \"dependsOn\" must be an array of keys or refs"],
      [{ ref: "a", title: "A", status: "doing" }, "task #1 (a): \"status\" must be one of todo, done, blocked"],
      [{ ref: "a", title: "A", status: 1 }, "task #1 (a): \"status\" must be one of todo, done, blocked"],
      [
        { ref: "a", title: "A", status: "in_progress" },
        "task #1 (a): imported tasks can't be in_progress/in_review because they have no assignee; import as todo and take them in the app",
      ],
      [
        { ref: "a", title: "A", status: "in_review" },
        "task #1 (a): imported tasks can't be in_progress/in_review because they have no assignee; import as todo and take them in the app",
      ],
      [{ ref: "a", title: "A", unknown: 1 }, "task #1 (a): unknown property \"unknown\""],
      [{ ref: "a", title: "A", dependsOn: ["a"] }, "task #1 (a): depends on itself"],
      [{ ref: "a", title: "A", dependsOn: ["ghost"] }, "task #1 (a): unknown dependency \"ghost\""],
    ])("rejects the task %j", async (task, expected) => {
      expect(await errorsOf({ tasks: [task] })).toEqual([expected]);
    });

    it("rejects explicit keys that already exist in the project, case-insensitively", async () => {
      seedTask("rf-02");
      expect(await errorsOf({ tasks: [{ key: "RF-02", title: "A" }] })).toEqual([
        "task #1 (RF-02): key \"RF-02\" already exists in the project",
      ]);
    });

    it("rejects duplicated keys and refs within the file", async () => {
      expect(
        await errorsOf({
          tasks: [
            { key: "RF-1", title: "A" },
            { key: "rf-1", title: "B" },
            { ref: "x", title: "C" },
            { ref: "x", title: "D" },
            { ref: "RF-1", title: "E" },
          ],
        }),
      ).toEqual([
        "task #2 (RF-1): \"RF-1\" is already used by task #1",
        "task #4 (x): \"x\" is already used by task #3",
        "task #5 (RF-1): \"RF-1\" is already used by task #1",
      ]);
    });

    it("rejects a ref that shadows an existing project key", async () => {
      seedTask("RF-9");
      expect(await errorsOf({ tasks: [{ ref: "rf-9", title: "A" }] })).toEqual([
        "task #1 (rf-9): ref \"rf-9\" clashes with existing key \"RF-9\"",
      ]);
    });

    it("rejects dependency cycles across the file", async () => {
      expect(
        await errorsOf({
          tasks: [
            { ref: "a", title: "A", dependsOn: ["rf-1"] },
            { ref: "b", title: "B", dependsOn: ["a"] },
            { key: "RF-1", title: "C", dependsOn: ["b"] },
          ],
        }),
      ).toEqual(["task #3 (RF-1): depending on \"b\" closes a dependency cycle"]);
    });

    it("accepts depending on existing tasks that depend on each other", async () => {
      const one = seedTask("RF-1");
      const two = seedTask("RF-2");
      store.dependencies.push({ taskId: two.id, dependsOnTaskId: one.id });
      const result = await importTasks(deps, "shop", { tasks: [{ ref: "a", title: "A", dependsOn: ["RF-2", "RF-1"] }] });
      expect(result).toMatchObject({ status: "imported" });
    });

    it("reports every error at once and writes nothing", async () => {
      seedTask("RF-01");
      const errors = await errorsOf({
        tasks: [
          { ref: "a", title: "" },
          { key: "RF-01", title: "Dup" },
          { ref: "c", title: "C", priority: "x", dependsOn: ["nope"] },
          { ref: "d", title: "D" },
        ],
      });
      expect(errors).toEqual([
        "task #1 (a): \"title\" must have 1–200 characters",
        "task #2 (RF-01): key \"RF-01\" already exists in the project",
        "task #3 (c): \"priority\" must be one of urgent, high, medium, low",
        "task #3 (c): unknown dependency \"nope\"",
      ]);
      expect(store.tasks.map((t) => t.key)).toEqual(["RF-01"]);
      expect(store.projects[0]?.nextTaskNumber).toBe(1);
      expect(notifications.events).toEqual([]);
    });
  });
});

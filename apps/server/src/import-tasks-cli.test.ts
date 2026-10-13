import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { InMemoryTaskStore } from "../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../test/fakes/recording-notifications.ts";
import { parseImportArgs, runImportTasksCli, type ImportCliDeps } from "./import-tasks-cli.ts";

const FILE = JSON.stringify({
  tasks: [
    { ref: "monorepo", title: "Monorepo", priority: "urgent" },
    { key: "RF-02", title: "Auth", dependsOn: ["monorepo"] },
  ],
});

describe("parseImportArgs", () => {
  it.each([
    [["--project", "shop", "tasks.json"], { slug: "shop", dryRun: false, source: "tasks.json" }],
    [["tasks.json", "--project=shop", "--dry-run"], { slug: "shop", dryRun: true, source: "tasks.json" }],
    [["--dry-run", "--project", "shop", "-"], { slug: "shop", dryRun: true, source: "-" }],
  ])("parses %j", (argv, expected) => {
    expect(parseImportArgs(argv)).toEqual({ ok: true, ...expected });
  });

  it.each([
    [[], "missing --project"],
    [["tasks.json"], "missing --project"],
    [["--project"], "missing --project"],
    [["--project", "shop"], "missing the JSON file (or - for stdin)"],
    [["--project", "shop", "a.json", "b.json"], "unexpected argument \"b.json\""],
    [["--project", "shop", "--force", "a.json"], "unknown option \"--force\""],
    [["--project", "a", "--project", "b", "a.json"], "--project given twice"],
  ])("rejects %j", (argv, message) => {
    expect(parseImportArgs(argv)).toEqual({ ok: false, message });
  });
});

describe("runImportTasksCli", () => {
  let store: InMemoryTaskStore;
  let notifications: RecordingNotifications & { flush: Mock<() => Promise<void>> };
  let out: string[];
  let err: string[];
  let deps: ImportCliDeps;
  let close: Mock<() => Promise<void>>;
  let createPublisher: Mock<ImportCliDeps["createPublisher"]>;

  beforeEach(() => {
    store = new InMemoryTaskStore();
    store.projects.push({ id: 1, slug: "shop", taskKeyPrefix: "AX", nextTaskNumber: 1, discordChannelId: "42" });
    notifications = Object.assign(new RecordingNotifications(), { flush: vi.fn(async () => {}) });
    out = [];
    err = [];
    close = vi.fn(async () => {});
    createPublisher = vi.fn<ImportCliDeps["createPublisher"]>(() => notifications);
    deps = {
      env: { DATABASE_URL: "postgres://db/x", DISCORD_BOT_TOKEN: "token", APP_BASE_URL: "https://tasks.example.com" },
      readFile: vi.fn(async (path: string) => {
        if (path === "tasks.json") return FILE;
        throw new Error(`ENOENT: no such file, open '${path}'`);
      }),
      readStdin: vi.fn(async () => FILE),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      openStore: vi.fn(() => ({ store, close })),
      createPublisher,
    };
  });

  it("imports the file, prints the result, sends the summary and flushes before closing", async () => {
    const order: string[] = [];
    notifications.flush.mockImplementation(async () => void order.push("flush"));
    close.mockImplementation(async () => void order.push("close"));

    expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(0);

    expect(store.tasks.map((t) => t.key)).toEqual(["AX-1", "RF-02"]);
    expect(out).toEqual([
      "Imported 2 tasks into shop (1 with explicit keys, 1 generated, 1 dependencies).",
      "  AX-1 ← monorepo",
    ]);
    expect(err).toEqual([]);
    expect(notifications.events).toEqual([expect.objectContaining({ type: "tasks_imported", count: 2 })]);
    expect(createPublisher).toHaveBeenCalledWith({ discordBotToken: "token", appBaseUrl: "https://tasks.example.com" });
    expect(deps.openStore).toHaveBeenCalledWith("postgres://db/x");
    expect(order).toEqual(["flush", "close"]);
  });

  it("reads the file from stdin with -", async () => {
    expect(await runImportTasksCli(["--project", "shop", "-"], deps)).toBe(0);
    expect(deps.readStdin).toHaveBeenCalled();
    expect(store.tasks).toHaveLength(2);
  });

  it("prints the plan without writing on --dry-run", async () => {
    expect(await runImportTasksCli(["--project", "shop", "--dry-run", "tasks.json"], deps)).toBe(0);
    expect(store.tasks).toEqual([]);
    expect(notifications.events).toEqual([]);
    expect(out).toEqual([
      "Dry run: would import 2 tasks into shop (1 with explicit keys, 1 generated, 1 dependencies).",
      "  AX-1 ← monorepo",
      "Roots (no dependencies): AX-1",
      "Statuses: 2 todo",
      "Nothing was written.",
    ]);
  });

  it("shows the count per status on --dry-run", async () => {
    deps.readFile = async () =>
      JSON.stringify({
        tasks: [
          { key: "RF-1", title: "One", status: "done" },
          { key: "RF-2", title: "Two", status: "done", dependsOn: ["RF-1"] },
          { key: "RF-3", title: "Three", status: "blocked" },
          { key: "RF-4", title: "Four" },
        ],
      });
    expect(await runImportTasksCli(["--project", "shop", "--dry-run", "tasks.json"], deps)).toBe(0);
    expect(out).toContain("Statuses: 1 todo, 2 done, 1 blocked");
  });

  describe("dependencies section", () => {
    const seed = (id: number, key: string) =>
      store.tasks.push({
        id, projectId: 1, key, title: key, description: null, status: "todo", priority: "medium", stage: null, assigneeId: null,
      });

    beforeEach(() => {
      seed(1, "RF-12");
      seed(2, "DOM-02");
      seed(3, "DOM-03");
      store.dependencies.push({ taskId: 1, dependsOnTaskId: 3 });
      deps.readFile = async () =>
        JSON.stringify({
          tasks: [{ ref: "x", title: "X", dependsOn: ["DOM-02"] }],
          dependencies: [{ task: "RF-12", dependsOn: ["DOM-02", "DOM-03", "x"] }],
        });
    });

    it("prints the added and already present edges", async () => {
      expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(0);
      expect(out).toEqual([
        "Imported 1 task into shop (0 with explicit keys, 1 generated, 1 dependencies, 2 added dependencies on existing tasks (1 already present)).",
        "  AX-1 ← x",
      ]);
      expect(notifications.events).toEqual([expect.objectContaining({ type: "tasks_imported", count: 1 })]);
    });

    it("lists the edges it would add on --dry-run", async () => {
      expect(await runImportTasksCli(["--project", "shop", "--dry-run", "tasks.json"], deps)).toBe(0);
      expect(out).toEqual([
        "Dry run: would import 1 task into shop (0 with explicit keys, 1 generated, 1 dependencies, 2 added dependencies on existing tasks (1 already present)).",
        "  AX-1 ← x",
        "Roots (no dependencies): none",
        "Statuses: 1 todo",
        "Added dependencies: RF-12 → DOM-02, RF-12 → AX-1",
        "Nothing was written.",
      ]);
    });

    it("omits the task lines when the file only adds edges, and posts nothing", async () => {
      deps.readFile = async () => JSON.stringify({ dependencies: [{ task: "RF-12", dependsOn: ["DOM-02", "DOM-03"] }] });
      expect(await runImportTasksCli(["--project", "shop", "--dry-run", "tasks.json"], deps)).toBe(0);
      expect(out).toEqual([
        "Dry run: would import 0 tasks into shop (0 with explicit keys, 0 generated, 0 dependencies, 1 added dependencies on existing tasks (1 already present)).",
        "Added dependencies: RF-12 → DOM-02",
        "Nothing was written.",
      ]);

      out.length = 0;
      expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(0);
      expect(out).toEqual([
        "Imported 0 tasks into shop (0 with explicit keys, 0 generated, 0 dependencies, 1 added dependencies on existing tasks (1 already present)).",
      ]);
      expect(notifications.events).toEqual([]);
    });

    it("prints the entry's index on validation errors", async () => {
      deps.readFile = async () => JSON.stringify({ dependencies: [{ task: "RF-12", dependsOn: ["ghost"] }] });
      expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(1);
      expect(err).toEqual(['dependency #1 (RF-12): unknown dependency "ghost"', "Nothing was imported."]);
    });
  });

  it("disables notifications without a Discord bot token", async () => {
    deps.env = { DATABASE_URL: "postgres://db/x" };
    expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(0);
    expect(createPublisher).toHaveBeenCalledWith({ discordBotToken: undefined, appBaseUrl: "" });
  });

  it("prints every validation error, one per line, and exits with 1", async () => {
    deps.readFile = async () => JSON.stringify({ tasks: [{ ref: "a" }, { ref: "b", title: "B", dependsOn: ["x"] }] });
    expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(1);
    expect(err).toEqual([
      'task #1 (a): "title" must have 1–200 characters',
      'task #2 (b): unknown dependency "x"',
      "Nothing was imported.",
    ]);
    expect(store.tasks).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it("rejects invalid JSON with exit code 1", async () => {
    deps.readFile = async () => "{ nope";
    expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(1);
    expect(err[0]).toMatch(/^file: invalid JSON/);
    expect(deps.openStore).not.toHaveBeenCalled();
  });

  it.each([
    [["--project", "shop"], "missing the JSON file (or - for stdin)"],
    [["--project", "shop", "missing.json"], "cannot read missing.json: ENOENT: no such file, open 'missing.json'"],
    [["--project", "nope", "tasks.json"], 'project "nope" not found'],
  ])("exits with 2 on usage or config errors (%j)", async (argv, message) => {
    expect(await runImportTasksCli(argv, deps)).toBe(2);
    expect(err[0]).toBe(message);
  });

  it("prints usage on a usage error", async () => {
    await runImportTasksCli([], deps);
    expect(err.join("\n")).toContain("Usage: node dist/import-tasks.js --project <slug> [--dry-run] <file.json | ->");
  });

  it("requires DATABASE_URL", async () => {
    deps.env = {};
    expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(2);
    expect(err).toEqual(["DATABASE_URL is required"]);
    expect(deps.openStore).not.toHaveBeenCalled();
  });

  it("requires a valid APP_BASE_URL when notifications are enabled", async () => {
    deps.env = { DATABASE_URL: "postgres://db/x", DISCORD_BOT_TOKEN: "token" };
    expect(await runImportTasksCli(["--project", "shop", "tasks.json"], deps)).toBe(2);
    expect(err).toEqual(["APP_BASE_URL is required"]);
  });
});

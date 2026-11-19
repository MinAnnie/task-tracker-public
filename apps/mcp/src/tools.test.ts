import { describe, expect, it, vi } from "vitest";
import { READ_ONLY_TOKEN_MESSAGE, TrackerApiError, type TrackerClient } from "./client.ts";
import { listItem, taskDetail } from "./test-fixtures.ts";
import { createToolHandlers, MISSING_API_URL_MESSAGE, MISSING_TOKEN_MESSAGE, type ToolResult } from "./tools.ts";
import type { Project, TaskListItem } from "./types.ts";

const RF: Project = { id: 1, slug: "rf", name: "Rental Fleet", taskKeyPrefix: "RF" };
const OPS: Project = { id: 2, slug: "ops", name: "Ops", taskKeyPrefix: "OPS" };

const TASKS: TaskListItem[] = [
  listItem({ key: "RF-1", title: "Schema", status: "done", priority: "urgent" }),
  listItem({ key: "RF-2", title: "Login", priority: "high", dependsOn: ["RF-1"] }),
  listItem({ key: "RF-3", title: "Board", priority: "urgent", dependsOn: ["RF-2"], pendingDependencies: ["RF-2"] }),
  listItem({ key: "RF-4", title: "Export", priority: "low", dependsOn: ["RF-2"], pendingDependencies: ["RF-2"] }),
  listItem({ key: "RF-5", title: "Docs", priority: "medium" }),
  listItem({
    key: "RF-6",
    title: "Theme",
    priority: "urgent",
    status: "in_progress",
    assignee: { login: "alice", name: null, avatarUrl: null },
  }),
];

function fakeClient(overrides: Partial<TrackerClient> = {}): TrackerClient {
  return {
    listProjects: vi.fn(async () => [RF]),
    listTasks: vi.fn(async () => TASKS),
    getTask: vi.fn(async () => taskDetail()),
    createTask: vi.fn(async () => taskDetail({ key: "RF-15", title: "Docs" })),
    updateTask: vi.fn(async () => taskDetail({ status: "in_review" })),
    addDependency: vi.fn(async () => ({ key: "RF-2", title: "Login", status: "todo" as const })),
    removeDependency: vi.fn(async () => undefined),
    ...overrides,
  };
}

const config = { token: "ttk_x", apiUrl: "https://tracker.test", project: undefined };
const text = (result: ToolResult) => result.content.map((c) => (c.type === "text" ? c.text : "")).join("");

describe("without a token", () => {
  it("every tool answers an isError result", async () => {
    const tools = createToolHandlers({ client: undefined, config: { ...config, token: undefined } });
    for (const result of [
      await tools.listProjects(),
      await tools.listTasks({}),
      await tools.getTask({ key: "RF-1" }),
      await tools.nextTasks({}),
      await tools.createTask({ title: "X" }),
      await tools.updateTask({ key: "RF-1", status: "done" }),
      await tools.addDependency({ key: "RF-1", dependsOn: "RF-2" }),
      await tools.removeDependency({ key: "RF-1", dependsOn: "RF-2" }),
    ]) {
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(MISSING_TOKEN_MESSAGE);
    }
    expect(MISSING_TOKEN_MESSAGE).toContain("TRACKER_API_TOKEN is not set");
  });
});

describe("with a client handed over by a host", () => {
  it("runs without a token of its own (the remote endpoint's in-process client)", async () => {
    const client = fakeClient();
    const tools = createToolHandlers({ client, config: { ...config, token: undefined } });
    const result = await tools.listProjects();
    expect(result.isError).toBeUndefined();
    expect(client.listProjects).toHaveBeenCalled();
  });
});

describe("without an API URL", () => {
  it("every tool answers an isError result without calling the API", async () => {
    const client = fakeClient();
    const tools = createToolHandlers({ client, config: { ...config, apiUrl: undefined } });
    for (const result of [
      await tools.listProjects(),
      await tools.listTasks({}),
      await tools.getTask({ key: "RF-1" }),
      await tools.nextTasks({}),
    ]) {
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(MISSING_API_URL_MESSAGE);
    }
    expect(client.listProjects).not.toHaveBeenCalled();
    expect(MISSING_API_URL_MESSAGE).toContain("TRACKER_API_URL is not set");
  });

  it("reports the missing token first when both are missing", async () => {
    const tools = createToolHandlers({ client: undefined, config: { ...config, token: undefined, apiUrl: undefined } });
    expect(text(await tools.listProjects())).toBe(MISSING_TOKEN_MESSAGE);
  });
});

describe("list_projects", () => {
  it("lists the token's projects", async () => {
    const result = await createToolHandlers({ client: fakeClient(), config }).listProjects();
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe("1 project visible to this token:\n- rf · Rental Fleet · keys RF-<n>");
  });

  it("turns API errors into isError results", async () => {
    const client = fakeClient({
      listProjects: vi.fn(async () => {
        throw new TrackerApiError("unauthorized", "The token is invalid, expired or revoked (401 invalid_token).");
      }),
    });
    const result = await createToolHandlers({ client, config }).listProjects();
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("The token is invalid, expired or revoked (401 invalid_token).");
  });

  it("does not leak unexpected errors' details beyond their message", async () => {
    const client = fakeClient({
      listProjects: vi.fn(async () => {
        throw new Error("kaboom");
      }),
    });
    const result = await createToolHandlers({ client, config }).listProjects();
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Unexpected error: kaboom");
  });
});

describe("project resolution", () => {
  it("uses the token's only project when none is given", async () => {
    const client = fakeClient();
    await createToolHandlers({ client, config }).listTasks({});
    expect(client.listTasks).toHaveBeenCalledWith("rf");
  });

  it("prefers the argument over TRACKER_PROJECT, case-insensitively", async () => {
    const client = fakeClient({ listProjects: vi.fn(async () => [RF, OPS]) });
    const tools = createToolHandlers({ client, config: { ...config, project: "rf" } });
    await tools.listTasks({});
    await tools.listTasks({ project: "OPS" });
    expect(client.listTasks).toHaveBeenNthCalledWith(1, "rf");
    expect(client.listTasks).toHaveBeenNthCalledWith(2, "ops");
  });

  it("asks for a project when the token sees several (a personal token) and none is configured", async () => {
    const client = fakeClient({ listProjects: vi.fn(async () => [RF, OPS]) });
    const tools = createToolHandlers({ client, config });
    for (const result of [await tools.listTasks({}), await tools.nextTasks({}), await tools.getTask({ key: "RF-1" })]) {
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        'Several projects are visible to this token (rf, ops). Pass "project" with one of these slugs ' +
          "(or set TRACKER_PROJECT for a default).",
      );
    }
    expect(client.listTasks).not.toHaveBeenCalled();
  });

  it("lists every project a personal token can access", async () => {
    const client = fakeClient({ listProjects: vi.fn(async () => [RF, OPS]) });
    const result = await createToolHandlers({ client, config }).listProjects();
    expect(text(result)).toContain("rf");
    expect(text(result)).toContain("ops");
  });

  it("works across projects with a personal token, one call per project", async () => {
    const client = fakeClient({ listProjects: vi.fn(async () => [RF, OPS]) });
    const tools = createToolHandlers({ client, config });
    await tools.listTasks({ project: "rf" });
    await tools.createTask({ project: "ops", title: "Rotate keys" });
    expect(client.listTasks).toHaveBeenCalledWith("rf");
    expect(client.createTask).toHaveBeenCalledWith("ops", { title: "Rotate keys" });
  });

  it("rejects a project the token cannot see", async () => {
    const result = await createToolHandlers({ client: fakeClient(), config }).listTasks({ project: "nope" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Project "nope" is not visible to this token. Visible: rf.');
  });

  it("reports when the token sees no project", async () => {
    const client = fakeClient({ listProjects: vi.fn(async () => []) });
    const result = await createToolHandlers({ client, config }).nextTasks({});
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("No project is visible to this token.");
  });
});

describe("list_tasks", () => {
  it("lists every task in board order with counts", async () => {
    const result = await createToolHandlers({ client: fakeClient(), config }).listTasks({});
    const lines = text(result).split("\n");
    expect(lines[0]).toBe("Rental Fleet (rf): 6 of 6 tasks match; showing 6.");
    expect(lines.slice(3).map((line) => line.split(" · ")[0])).toEqual(["RF-1", "RF-3", "RF-6", "RF-2", "RF-5", "RF-4"]);
  });

  it("applies filters and the limit", async () => {
    const tools = createToolHandlers({ client: fakeClient(), config });
    const ready = text(await tools.listTasks({ availability: "ready", limit: 1 }));
    expect(ready.split("\n")[0]).toBe("Rental Fleet (rf): 2 of 6 tasks match; showing 1.");
    expect(ready).toContain("RF-2 · todo · high");
    const blocked = text(await tools.listTasks({ availability: "blocked", priority: ["low"] }));
    expect(blocked).toContain("RF-4 · todo · low · — · unassigned · Export — waiting on RF-2");
    expect(text(await tools.listTasks({ assignee: "alice", status: ["in_progress"] }))).toContain("RF-6");
    expect(text(await tools.listTasks({ search: "doc", stage: [""] }))).toContain("RF-5");
  });

  it("defaults to 50 tasks", async () => {
    const many = Array.from({ length: 60 }, (_, i) => listItem({ key: `RF-${i + 1}` }));
    const client = fakeClient({ listTasks: vi.fn(async () => many) });
    const result = text(await createToolHandlers({ client, config }).listTasks({}));
    expect(result.split("\n")[0]).toBe("Rental Fleet (rf): 60 of 60 tasks match; showing 50.");
  });
});

describe("get_task", () => {
  it("returns the AI-ready brief with a link on the tracker's origin", async () => {
    const client = fakeClient();
    const result = await createToolHandlers({ client, config }).getTask({ key: " rf-14 ", project: "rf" });
    expect(client.getTask).toHaveBeenCalledWith("rf", "rf-14");
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("# RF-14 — Add login with GitHub");
    expect(text(result)).toContain("- Link: https://tracker.test/projects/rf/tasks/RF-14");
  });

  it("reports a missing task as an error", async () => {
    const client = fakeClient({
      getTask: vi.fn(async () => {
        throw new TrackerApiError("not_found", 'Task "RF-99" was not found in project "rf".');
      }),
    });
    const result = await createToolHandlers({ client, config }).getTask({ key: "RF-99" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Task "RF-99" was not found in project "rf".');
  });
});

describe("next_tasks", () => {
  it("lists ready tasks by priority with what each unblocks", async () => {
    const result = text(await createToolHandlers({ client: fakeClient(), config }).nextTasks({}));
    expect(result).toBe(
      [
        "Rental Fleet (rf): 2 ready tasks; showing the top 2 by priority.",
        "",
        "1. RF-2 · high · — · Login",
        "   Ready: unassigned, status todo, its 1 dependency is done. Unblocks: RF-3, RF-4.",
        "2. RF-5 · medium · — · Docs",
        "   Ready: unassigned, status todo, no dependencies. Unblocks nothing.",
        "",
        "Use get_task with a key for the full brief.",
      ].join("\n"),
    );
  });

  it("honors the limit", async () => {
    const result = text(await createToolHandlers({ client: fakeClient(), config }).nextTasks({ limit: 1 }));
    expect(result).toContain("2 ready tasks; showing the top 1 by priority.");
    expect(result).not.toContain("RF-5");
  });
});

describe("create_task", () => {
  it("creates the task in the resolved project and returns its brief", async () => {
    const client = fakeClient();
    const result = await createToolHandlers({ client, config }).createTask({
      title: "Docs",
      priority: "high",
      stage: "Backend",
      description: "Write them",
      dependsOn: [" RF-1 ", "rf-2"],
    });
    expect(client.createTask).toHaveBeenCalledWith("rf", {
      title: "Docs",
      priority: "high",
      stage: "Backend",
      description: "Write them",
      dependsOnKeys: ["RF-1", "rf-2"],
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/^Created RF-15\.\n\n# RF-15 — Docs\n/);
  });

  it("sends only the fields given", async () => {
    const client = fakeClient();
    await createToolHandlers({ client, config }).createTask({ title: "Docs" });
    expect(client.createTask).toHaveBeenCalledWith("rf", { title: "Docs" });
  });

  it("passes on the read-only token message", async () => {
    const client = fakeClient({
      createTask: vi.fn(async () => {
        throw new TrackerApiError("read_only", READ_ONLY_TOKEN_MESSAGE);
      }),
    });
    const result = await createToolHandlers({ client, config }).createTask({ title: "Docs" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(READ_ONLY_TOKEN_MESSAGE);
  });
});

describe("update_task", () => {
  it("sends the changed fields, null clearing the stage, and returns the brief", async () => {
    const client = fakeClient();
    const result = await createToolHandlers({ client, config }).updateTask({
      key: " RF-14 ",
      status: "in_review",
      stage: null,
    });
    expect(client.updateTask).toHaveBeenCalledWith("rf", "RF-14", { status: "in_review", stage: null });
    expect(text(result)).toMatch(/^Updated RF-14\.\n\n# RF-14 — /);
  });

  it("asks for at least one change", async () => {
    const client = fakeClient();
    const result = await createToolHandlers({ client, config }).updateTask({ key: "RF-14" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Pass at least one field to change: title, description, priority, stage or status.");
    expect(client.updateTask).not.toHaveBeenCalled();
  });
});

describe("add_dependency / remove_dependency", () => {
  it("adds a dependency and says what the task now waits on", async () => {
    const client = fakeClient();
    const result = await createToolHandlers({ client, config }).addDependency({ key: "RF-3", dependsOn: " RF-2 " });
    expect(client.addDependency).toHaveBeenCalledWith("rf", "RF-3", "RF-2");
    expect(text(result)).toBe("RF-3 now depends on RF-2 — Login (todo).");
  });

  it("removes a dependency", async () => {
    const client = fakeClient();
    const result = await createToolHandlers({ client, config }).removeDependency({ key: "RF-3", dependsOn: "RF-2" });
    expect(client.removeDependency).toHaveBeenCalledWith("rf", "RF-3", "RF-2");
    expect(text(result)).toBe("RF-3 no longer depends on RF-2.");
  });
});

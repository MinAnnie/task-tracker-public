import { READ_ONLY_TOKEN_MESSAGE, TrackerApiError } from "@task-tracker/mcp";
import { describe, expect, it, vi } from "vitest";
import type { PersonalApiTokenCaller, ProjectApiTokenCaller } from "../application/api-tokens.ts";
import type { AuthenticatedUser } from "../application/sessions.ts";
import type { BoardTask, TaskDetail } from "../application/tasks.ts";
import { createInProcessTrackerClient, type InProcessTrackerDeps } from "./in-process-tracker-client.ts";

const admin: AuthenticatedUser = { id: 1, githubLogin: "octocat", name: null, avatarUrl: null, role: "admin" };
const mona: AuthenticatedUser = { id: 2, githubLogin: "mona", name: "Mona", avatarUrl: null, role: "member" };
const shop = { id: 3, slug: "shop", name: "Shop", taskKeyPrefix: "SH", discordInviteUrl: null };
const blog = { id: 4, slug: "blog", name: "Blog", taskKeyPrefix: "BL", discordInviteUrl: null };

const projectToken = (scope: "read" | "write"): ProjectApiTokenCaller => ({
  kind: "api_token",
  tokenId: 10,
  scope,
  projectId: shop.id,
  project: shop,
  creator: { id: admin.id, githubLogin: admin.githubLogin, name: null, avatarUrl: null },
});

const personalToken = (owner: AuthenticatedUser, scope: "read" | "write"): PersonalApiTokenCaller => ({
  kind: "api_token",
  tokenId: 11,
  scope,
  projectId: null,
  project: null,
  creator: { id: owner.id, githubLogin: owner.githubLogin, name: owner.name, avatarUrl: owner.avatarUrl },
  owner,
});

const board: BoardTask = {
  key: "SH-1",
  title: "Checkout",
  status: "todo",
  priority: "high",
  stage: null,
  assignee: null,
  pullRequests: [],
  dependsOn: [],
  pendingDependencies: [],
  canTake: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const detail: TaskDetail = {
  ...board,
  description: null,
  dependsOn: [],
  blocks: [],
  pullRequests: [],
};

function deps(overrides: Partial<InProcessTrackerDeps> = {}): InProcessTrackerDeps {
  return {
    listVisibleProjects: vi.fn(async () => [shop, blog]),
    listTasks: vi.fn(async () => ({ status: "ok" as const, tasks: [board] })),
    getTask: vi.fn(async () => ({ status: "ok" as const, task: detail })),
    createTask: vi.fn(async () => ({ status: "created" as const, task: detail })),
    updateTask: vi.fn(async () => ({ status: "ok" as const, task: detail })),
    addTaskDependency: vi.fn(async () => ({
      status: "created" as const,
      dependency: { key: "SH-2", title: "Cart", status: "done" as const },
    })),
    removeTaskDependency: vi.fn(async () => ({ status: "removed" as const })),
    resolveApiTokenActor: vi.fn(async () => admin),
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<TrackerApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TrackerApiError);
    return error as TrackerApiError;
  }
  throw new Error("expected a failure");
}

describe("in-process TrackerClient: reads", () => {
  it("a project token sees only its own project", async () => {
    const d = deps();
    const client = createInProcessTrackerClient(d, projectToken("read"));
    expect(await client.listProjects()).toEqual([shop]);
    expect(d.listVisibleProjects).not.toHaveBeenCalled();
  });

  it("a personal token sees what its owner sees, with the owner's current role", async () => {
    const d = deps({ listVisibleProjects: vi.fn(async () => [blog]) });
    const client = createInProcessTrackerClient(d, personalToken(mona, "read"));
    expect(await client.listProjects()).toEqual([blog]);
    expect(d.listVisibleProjects).toHaveBeenCalledWith(mona);
  });

  it("reads the board and a task as the token (the use cases check project access)", async () => {
    const caller = projectToken("read");
    const d = deps();
    const client = createInProcessTrackerClient(d, caller);
    expect(await client.listTasks("shop")).toEqual([board]);
    expect(await client.getTask("shop", "sh-1")).toEqual(detail);
    expect(d.listTasks).toHaveBeenCalledWith(caller, "shop");
    expect(d.getTask).toHaveBeenCalledWith(caller, "shop", "sh-1");
  });

  it("words failures exactly like the HTTP client does for the same API answer", async () => {
    const client = createInProcessTrackerClient(
      deps({
        listTasks: vi.fn(async () => ({ status: "project_not_found" as const })),
        getTask: vi.fn(async () => ({ status: "task_not_found" as const })),
      }),
      projectToken("read"),
    );
    expect((await failure(client.listTasks("blog"))).message).toBe(
      'Project "blog" was not found (or is not visible to this token).',
    );
    expect((await failure(client.getTask("shop", "SH-9"))).message).toBe('Task "SH-9" was not found in project "shop".');
  });

  it("a member's personal token on another project answers the forbidden message", async () => {
    const client = createInProcessTrackerClient(
      deps({ listTasks: vi.fn(async () => ({ status: "forbidden" as const })) }),
      personalToken(mona, "read"),
    );
    expect((await failure(client.listTasks("shop"))).message).toContain('cannot access project "shop" (403 forbidden)');
  });
});

describe("in-process TrackerClient: writes", () => {
  it("a read-only token cannot write, and no use case runs", async () => {
    const d = deps();
    const client = createInProcessTrackerClient(d, projectToken("read"));
    for (const attempt of [
      client.createTask("shop", { title: "X" }),
      client.updateTask("shop", "SH-1", { status: "done" }),
      client.addDependency("shop", "SH-1", "SH-2"),
      client.removeDependency("shop", "SH-1", "SH-2"),
    ]) {
      const error = await failure(attempt);
      expect(error.kind).toBe("read_only");
      expect(error.message).toBe(READ_ONLY_TOKEN_MESSAGE);
    }
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.updateTask).not.toHaveBeenCalled();
    expect(d.addTaskDependency).not.toHaveBeenCalled();
    expect(d.removeTaskDependency).not.toHaveBeenCalled();
  });

  it("a member's personal write token only reads (its owner is no longer an admin)", async () => {
    const d = deps();
    const client = createInProcessTrackerClient(d, personalToken(mona, "write"));
    expect((await failure(client.createTask("shop", { title: "X" }))).kind).toBe("read_only");
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it("a project write token cannot write to another project", async () => {
    const d = deps();
    const client = createInProcessTrackerClient(d, projectToken("write"));
    expect((await failure(client.createTask("blog", { title: "X" }))).message).toBe(
      'Project "blog" was not found (or is not visible to this token).',
    );
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it("a project write token writes as its creator with their current role", async () => {
    const caller = projectToken("write");
    const d = deps();
    const client = createInProcessTrackerClient(d, caller);
    expect(await client.createTask("shop", { title: "X", dependsOnKeys: ["SH-2"] })).toEqual(detail);
    expect(d.resolveApiTokenActor).toHaveBeenCalledWith(caller);
    expect(d.createTask).toHaveBeenCalledWith(admin, "shop", { title: "X", dependsOnKeys: ["SH-2"] });
  });

  it("refuses with the forbidden write message once the creator lost access", async () => {
    const d = deps({ resolveApiTokenActor: vi.fn(async () => undefined) });
    const client = createInProcessTrackerClient(d, projectToken("write"));
    const error = await failure(client.updateTask("shop", "SH-1", { status: "done" }));
    expect(error.message).toMatch(/^Not allowed \(403 forbidden\)/);
    expect(d.updateTask).not.toHaveBeenCalled();
  });

  it("an admin's personal write token acts as the admin and sends the body as JSON would", async () => {
    const d = deps();
    const client = createInProcessTrackerClient(d, personalToken(admin, "write"));
    await client.updateTask("blog", "BL-1", { description: null, title: undefined });
    expect(d.updateTask).toHaveBeenCalledWith(admin, "blog", "BL-1", { description: null });
    expect(await client.addDependency("blog", "BL-1", "BL-2")).toEqual({ key: "SH-2", title: "Cart", status: "done" });
    expect(d.addTaskDependency).toHaveBeenCalledWith(admin, "blog", "BL-1", "BL-2");
    await expect(client.removeDependency("blog", "BL-1", "BL-2")).resolves.toBeUndefined();
    expect(d.resolveApiTokenActor).not.toHaveBeenCalled();
  });

  it("words refused changes like the HTTP client (status, code and details)", async () => {
    const client = createInProcessTrackerClient(
      deps({
        createTask: vi.fn(async () => ({ status: "invalid_dependency" as const, unknownKeys: ["SH-99"] })),
        updateTask: vi.fn(async () => ({ status: "dependencies_pending" as const, pendingDependencies: ["SH-2"] })),
        removeTaskDependency: vi.fn(async () => ({ status: "dependency_not_found" as const })),
      }),
      personalToken(admin, "write"),
    );
    expect((await failure(client.createTask("shop", { title: "X" }))).message).toBe(
      "The Task Tracker API refused the change (400 invalid_dependency). Unknown task keys: SH-99.",
    );
    expect((await failure(client.updateTask("shop", "SH-1", { status: "in_progress" }))).message).toBe(
      "The Task Tracker API refused the change (409 dependencies_pending). Pending dependencies: SH-2.",
    );
    expect((await failure(client.removeDependency("shop", "SH-1", "SH-2"))).message).toBe(
      'SH-1 does not depend on SH-2 in project "shop".',
    );
  });
});

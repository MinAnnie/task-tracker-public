import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTrackerMcpServer, READ_ONLY_TOKEN_MESSAGE, TOOL_NAMES, type TrackerClient } from "@task-tracker/mcp";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import type { ApiTokenCaller } from "../application/api-tokens.ts";
import type { AuthenticatedUser } from "../application/sessions.ts";
import {
  addTaskDependency,
  createTask,
  getTask,
  listTasks,
  removeTaskDependency,
  updateTask,
  type TasksDeps,
} from "../application/tasks.ts";
import { createMcpRequestHandler } from "./mcp-endpoint.ts";

const admin: AuthenticatedUser = { id: 1, githubLogin: "octocat", name: "Octo", avatarUrl: null, role: "admin" };
const shop = { id: 3, slug: "shop", name: "Shop", taskKeyPrefix: "SH", discordInviteUrl: null };
const blog = { id: 4, slug: "blog", name: "Blog", taskKeyPrefix: "BL", discordInviteUrl: null };
const creator = { id: admin.id, githubLogin: admin.githubLogin, name: admin.name, avatarUrl: null };

const projectCaller = (scope: "read" | "write"): ApiTokenCaller => ({
  kind: "api_token",
  tokenId: scope === "read" ? 1 : 2,
  scope,
  projectId: shop.id,
  project: shop,
  creator,
});
const personalCaller: ApiTokenCaller = {
  kind: "api_token",
  tokenId: 3,
  scope: "write",
  projectId: null,
  project: null,
  creator,
  owner: admin,
};
const CALLERS: Record<string, ApiTokenCaller> = {
  "ttk-read": projectCaller("read"),
  "ttk-write": projectCaller("write"),
  "ttk-personal": personalCaller,
};

const URL_BASE = "https://tasks.example.com";

describe("remote MCP endpoint over Streamable HTTP (SDK client)", () => {
  let store: InMemoryTaskStore;
  let handle: ReturnType<typeof createMcpRequestHandler>;

  beforeEach(() => {
    store = new InMemoryTaskStore();
    store.projects.push(
      { id: shop.id, slug: shop.slug, taskKeyPrefix: shop.taskKeyPrefix, nextTaskNumber: 2, discordChannelId: null },
      { id: blog.id, slug: blog.slug, taskKeyPrefix: blog.taskKeyPrefix, nextTaskNumber: 2, discordChannelId: null },
    );
    store.users.push(creator);
    const at = new Date("2026-01-01T00:00:00Z");
    const task = { description: null, status: "todo" as const, priority: "high" as const, stage: null };
    store.tasks.push(
      { ...task, id: 10, projectId: shop.id, key: "SH-1", title: "Checkout", assigneeId: null, createdAt: at, updatedAt: at },
      { ...task, id: 11, projectId: blog.id, key: "BL-1", title: "Post", assigneeId: null, createdAt: at, updatedAt: at },
    );
    const tasksDeps: TasksDeps = { store, adminLogins: ["octocat"], notifications: new RecordingNotifications() };
    handle = createMcpRequestHandler({
      appBaseUrl: URL_BASE,
      listVisibleProjects: async (user) => (user.role === "admin" ? [shop, blog] : []),
      listTasks: (viewer, slug) => listTasks(tasksDeps, viewer, slug),
      getTask: (viewer, slug, key) => getTask(tasksDeps, viewer, slug, key),
      createTask: (user, slug, body) => createTask(tasksDeps, user, slug, body),
      updateTask: (user, slug, key, body) => updateTask(tasksDeps, user, slug, key, body),
      addTaskDependency: (user, slug, key, dependsOnKey) => addTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
      removeTaskDependency: (user, slug, key, dependsOnKey) =>
        removeTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
      resolveApiTokenActor: async () => admin,
    });
  });

  /** An SDK client whose HTTP requests reach the handler as `POST /mcp` would, with the token's caller. */
  async function connect(token: string): Promise<Client> {
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const caller = CALLERS[(request.headers.get("authorization") ?? "").replace(/^Bearer /, "")];
      if (caller === undefined) return new Response(null, { status: 401 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      return handle(caller, request, await request.clone().json());
    };
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", URL_BASE), {
      fetch,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "remote-test", version: "0.0.0" });
    await client.connect(transport);
    return client;
  }

  const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
    (result.content as { type: string; text: string }[]).map((c) => c.text).join("");

  it("lists exactly the stdio server's tools, with identical definitions", async () => {
    const remote = await connect("ttk-read");
    const { tools } = await remote.listTools();

    const stdio = createTrackerMcpServer({
      client: {} as TrackerClient,
      config: { token: "ttk_x", apiUrl: URL_BASE, project: undefined },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const local = new Client({ name: "local", version: "0.0.0" });
    await Promise.all([stdio.connect(serverSide), local.connect(clientSide)]);

    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toEqual((await local.listTools()).tools);
    expect(remote.getServerVersion()?.name).toBe("task-tracker");
  });

  it("a project token sees only its project", async () => {
    const remote = await connect("ttk-read");
    expect(text(await remote.callTool({ name: "list_projects", arguments: {} }))).toBe(
      "1 project visible to this token:\n- shop · Shop · keys SH-<n>",
    );
    const board = await remote.callTool({ name: "list_tasks", arguments: {} });
    expect(text(board)).toContain("SH-1 · todo · high");
    const other = await remote.callTool({ name: "list_tasks", arguments: { project: "blog" } });
    expect(other.isError).toBe(true);
    expect(text(other)).toBe('Project "blog" is not visible to this token. Visible: shop.');
  });

  it("a read-only token cannot call the write tools, and nothing is written", async () => {
    const remote = await connect("ttk-read");
    for (const [name, args] of [
      ["create_task", { title: "Sneaky" }],
      ["update_task", { key: "SH-1", status: "done" }],
      ["add_dependency", { key: "SH-1", dependsOn: "SH-1" }],
      ["remove_dependency", { key: "SH-1", dependsOn: "SH-1" }],
    ] as const) {
      const result = await remote.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(READ_ONLY_TOKEN_MESSAGE);
    }
    expect(store.tasks.map((t) => [t.key, t.status])).toEqual([
      ["SH-1", "todo"],
      ["BL-1", "todo"],
    ]);
  });

  it("a write token creates a task through the use cases and returns its brief with an app link", async () => {
    const remote = await connect("ttk-write");
    const result = await remote.callTool({ name: "create_task", arguments: { title: "Refunds", dependsOn: ["sh-1"] } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/^Created SH-2\./);
    expect(text(result)).toContain(`${URL_BASE}/projects/shop/tasks/SH-2`);
    expect(store.tasks.find((t) => t.key === "SH-2")?.title).toBe("Refunds");
  });

  it("an admin's personal write token reaches every project, naming one with 'project'", async () => {
    const remote = await connect("ttk-personal");
    const ambiguous = await remote.callTool({ name: "next_tasks", arguments: {} });
    expect(text(ambiguous)).toContain("Several projects are visible to this token (shop, blog)");
    const result = await remote.callTool({ name: "update_task", arguments: { project: "blog", key: "BL-1", title: "Hi" } });
    expect(text(result)).toMatch(/^Updated BL-1\./);
  });
});
